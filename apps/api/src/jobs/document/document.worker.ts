import { Worker, Job, UnrecoverableError, DelayedError } from "bullmq";
import { randomUUID } from "crypto";
import { db, document, documentChunk, aiUsageLog } from "@repo/db";
import { upsertVectors, deleteVectorsByFilter, type Point } from "@repo/qdrant";
import { eq, and, ne, lt, isNull } from "@repo/db/drizzle-orm";
import { OpenRouterEmbed } from "@repo/llm/openrouter";
import { redisConnection } from "../connection";
import { redis } from "../../config/redis";
import { acquireDocumentLock } from "./document.lock";
import { addDeleteDocumentJob } from "./document.queue";
import {
	type IndexDocumentJobData,
	type DeleteDocumentJobData,
	type ReindexDocumentJobData,
	type IndexDocumentJobResult,
	DocumentJobNames,
} from "./types";
import { chunkText, estimateTokens } from "../../services/chunking.service";
import { getProfile, getDefaultProfile } from "../../services/profile.service";
import {
	qdrant,
	ensureCollection,
	deleteDocumentVectors,
	type VectorPayload,
} from "../../services/qdrant.shared";
import {
	reserveCredits,
	settleReservation,
	findTransactionByReference,
	type CreditReservation,
	type DbTransaction,
} from "../../services/credits.service";
import { invalidateUsageStats } from "../../services/usage.service";
import { calculateCost, CREDIT_EPSILON } from "../../utils/cost";
import { describeError } from "../../config/redact";
import {
	isPermanentProviderError,
	PROVIDER_REFUSED_INDEXING_REASON,
} from "../../utils/provider-error";
import {
	DEFAULT_CHUNK_SIZE,
	DEFAULT_CHUNK_OVERLAP,
} from "../../utils/profile_schema";

// Constants
const QUEUE_NAME = "document";
// Chunks per embedding request, Postgres insert and Qdrant upsert
const INDEX_BATCH_SIZE = 64;
const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
// Delay before a job retries after finding its document locked
const LOCK_RETRY_DELAY_MS = 5_000;

/**
 * Queue the deletion of the owner's older documents with the same source and
 * profile (a null profile matches a null profile). Called once the new document
 * is indexed and billed, so errors are logged and never fail the job.
 */
async function replaceOlderDocuments(
	documentId: string,
	doc: {
		userId: string;
		source: string | null;
		profileId: string | null;
		createdAt: Date;
	},
): Promise<void> {
	if (!doc.source) return;
	try {
		const older = await db
			.select({ id: document.id })
			.from(document)
			.where(
				and(
					eq(document.userId, doc.userId),
					eq(document.source, doc.source),
					doc.profileId
						? eq(document.profileId, doc.profileId)
						: isNull(document.profileId),
					ne(document.id, documentId),
					lt(document.createdAt, doc.createdAt),
				),
			);
		for (const { id } of older) {
			await addDeleteDocumentJob({ documentId: id, userId: doc.userId });
		}
		if (older.length > 0)
			console.log(
				`[Document Worker] Document ${documentId}: Replaced ${older.length} older document(s) with source ${doc.source}`,
			);
	} catch (err) {
		console.error(
			`[Document Worker] Failed to replace older documents for ${documentId}:`,
			describeError(err),
		);
	}
}

/**
 * Index a document: chunk, embed, store chunks and vectors, bill.
 * Shared by the index and re-index jobs.
 *
 * - Idempotent: existing chunks and vectors of the document are removed (after
 *   the reservation succeeded), so a retry or a crash recovery never duplicates
 *   them. If the reservation is refused the old index is kept and the document
 *   is marked failed with the reason in metadata.error.
 * - Billing: the real chunk token counts are reserved up front. The reservation
 *   is keyed by job id, so a retry reuses it. It is settled on the tokens actually
 *   embedded, on success or on terminal failure. The settlement, its "already
 *   settled" marker (the usage log row) and the indexed status are one transaction.
 * - The caller (processJob) holds a per-document lock.
 */
async function processIndexDocument(
	job: Job<IndexDocumentJobData>,
): Promise<IndexDocumentJobResult> {
	const startTime = Date.now();
	const { documentId, organizationId, userId } = job.data;
	const jobId = job.id ?? documentId;
	const reserveRef = `reserve-${jobId}`;
	const usageId = `usage-${jobId}`;
	const isRetry = job.attemptsMade > 0 || job.attemptsStarted > 1;
	const maxAttempts = job.opts.attempts ?? 1;

	let embeddingModelId = DEFAULT_EMBEDDING_MODEL;
	let reservation: CreditReservation | null = null;
	let settled = false;
	// Tokens embedded (and paid to the provider) by earlier failed attempts + this one
	const paidBefore = job.data.embeddedTokens ?? 0;
	let attemptTokens = 0;

	const findReservation = async (): Promise<CreditReservation | null> => {
		const tx = await findTransactionByReference(organizationId, reserveRef);
		if (!tx) return null;
		return {
			orgId: organizationId,
			userId,
			amount: Math.abs(Number(tx.amount)),
			transactionId: tx.id,
		};
	};

	/**
	 * Settle the reservation on the tokens embedded. The usage log row is the
	 * "already settled" marker and is written in the same transaction as the
	 * refund/charge (and the final status update), so a retry can neither settle
	 * twice nor skip billing.
	 */
	const settle = async (
		tokens: number,
		context: Record<string, unknown>,
		finalize?: (tx: DbTransaction) => Promise<void>,
	) => {
		const actualCost = calculateCost(embeddingModelId, tokens, 0);
		const noReservation = {
			orgId: organizationId,
			userId,
			amount: 0,
			transactionId: "",
		};
		try {
			await settleReservation(
				reservation ?? noReservation,
				actualCost,
				`embedding ${documentId}`,
				usageId,
				async (tx) => {
					// Nothing reserved and nothing embedded: no marker needed
					if (reservation || tokens > 0) {
						const inserted = await tx
							.insert(aiUsageLog)
							.values({
								id: usageId,
								organizationId,
								userId,
								operationType: "embedding",
								model: embeddingModelId,
								inputTokens: tokens,
								outputTokens: 0,
								totalTokens: tokens,
								costCredits: actualCost.toFixed(8),
								metadata: {
									documentId,
									context: "document_indexing",
									...context,
								},
							})
							.onConflictDoNothing()
							.returning({ id: aiUsageLog.id });
						// Marker already present: an earlier attempt settled
						if (inserted.length === 0) return false;
					}
					await finalize?.(tx);
					return true;
				},
			);
			settled = true;
			await invalidateUsageStats(organizationId);
		} catch (err) {
			// Rolled back as a whole: nothing was settled, the marker is absent
			console.error(
				`[Document Worker] SETTLEMENT FAILED for ${documentId} (org ${organizationId}, reserved ${reservation?.amount ?? 0}, actual ${actualCost}):`,
				describeError(err),
			);
			throw err;
		}
	};

	// True once the old chunks and vectors were (or may have been) replaced
	let indexReplaced = job.data.indexReplaced ?? false;

	/** Keep the old index, mark the document failed with the reason in metadata.error. */
	const markIndexingRefused = async (
		reason: string,
		extra: { chunkCount?: number } = {},
	) => {
		try {
			const [current] = await db
				.select({ metadata: document.metadata })
				.from(document)
				.where(eq(document.id, documentId));
			if (!current) return;
			await db
				.update(document)
				.set({
					status: "failed",
					...extra,
					metadata: { ...(current.metadata ?? {}), error: reason },
				})
				.where(eq(document.id, documentId));
		} catch (markErr) {
			console.error(
				`[Document Worker] Failed to record refusal for ${documentId}:`,
				describeError(markErr),
			);
		}
	};

	console.log(`[Document Worker] Starting indexing for document: ${documentId}`);

	try {
		// The document row is the source of truth (owner, content, settings)
		const [doc] = await db
			.select({
				userId: document.userId,
				profileId: document.profileId,
				content: document.content,
				source: document.source,
				metadata: document.metadata,
				status: document.status,
				createdAt: document.createdAt,
			})
			.from(document)
			.where(eq(document.id, documentId));

		// Deleted while queued: nothing to index and nothing was spent
		if (!doc) {
			console.warn(`[Document Worker] Document ${documentId} no longer exists`);
			return { documentId, chunkCount: 0, processingTimeMs: Date.now() - startTime };
		}
		if (doc.userId !== userId) {
			throw new UnrecoverableError(
				`Document ${documentId} does not belong to user ${userId}`,
			);
		}

		// A retry whose billing already completed must not bill again
		if (isRetry) {
			const [log] = await db
				.select({ id: aiUsageLog.id })
				.from(aiUsageLog)
				.where(eq(aiUsageLog.id, usageId));
			if (log) {
				// Settlement and the "indexed" status commit together, so the work is
				// done: a later step (progress update) failed after the commit
				if (doc.status === "indexed") {
					if (job.data.replaceSource)
						await replaceOlderDocuments(documentId, doc);
					return {
						documentId,
						chunkCount: 0,
						processingTimeMs: Date.now() - startTime,
					};
				}
				settled = true;
			}
		}

		const profileId = job.data.profileId ?? doc.profileId;
		const profile =
			(profileId ? await getProfile(profileId, userId) : null) ??
			(await getDefaultProfile(userId));
		embeddingModelId = profile?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
		const collectionName = await ensureCollection(embeddingModelId);

		await job.updateProgress(5);

		// Step 1: Chunk the content
		const chunks = await chunkText(doc.content, {
			chunkSize: profile?.chunkSize ?? DEFAULT_CHUNK_SIZE,
			chunkOverlap: profile?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
			separators: profile?.separators || undefined,
		});
		console.log(
			`[Document Worker] Document ${documentId}: Created ${chunks.length} chunks`,
		);

		const tokenCounts = chunks.map((c) => estimateTokens(c.content));
		const estimatedTokens = tokenCounts.reduce((sum, n) => sum + n, 0);

		await job.updateProgress(15);

		// Step 2: Reserve the cost of embedding every chunk before spending anything
		if (!settled) {
			if (isRetry) reservation = await findReservation();
			const estimatedCost = calculateCost(embeddingModelId, estimatedTokens, 0);
			if (!reservation && estimatedCost >= CREDIT_EPSILON) {
				try {
					reservation = await reserveCredits({
						orgId: organizationId,
						userId,
						amount: estimatedCost,
						description: `embedding reservation — ${documentId} (${chunks.length} chunks)`,
						referenceId: reserveRef,
					});
				} catch (err) {
					// Retrying cannot add credits. The old index (chunks, vectors, model)
					// is still untouched: keep it and record why this job gave up.
					const reason =
						err instanceof Error ? err.message : "Insufficient credits";
					await markIndexingRefused(reason);
					throw new UnrecoverableError(reason);
				}
			}
		}

		// Step 2b: Paid for, now it is safe to replace the old index. Record the model
		// first so searches only see the document through its own collection.
		const { error: _previousError, ...cleanMetadata } = doc.metadata ?? {};
		await db
			.update(document)
			.set({
				status: "processing",
				embeddingModel: embeddingModelId,
				chunkCount: 0,
				metadata: cleanMetadata,
			})
			.where(eq(document.id, documentId));
		indexReplaced = true;

		// Idempotent start: drop whatever an earlier attempt or model left behind
		await deleteDocumentVectors(documentId);
		await db
			.delete(documentChunk)
			.where(eq(documentChunk.documentId, documentId));

		// Step 3: Embed, then store chunks and vectors, batch by batch
		const totalBatches = Math.ceil(chunks.length / INDEX_BATCH_SIZE);
		for (let i = 0; i < chunks.length; i += INDEX_BATCH_SIZE) {
			const batch = chunks.slice(i, i + INDEX_BATCH_SIZE);

			let embedded: Awaited<ReturnType<typeof OpenRouterEmbed>>;
			try {
				embedded = await OpenRouterEmbed(
					embeddingModelId,
					batch.map((c) => c.content),
				);
			} catch (err) {
				// Bad key, unknown model, no provider credit: a retry cannot succeed
				if (isPermanentProviderError(err)) {
					throw new UnrecoverableError(PROVIDER_REFUSED_INDEXING_REASON);
				}
				throw err;
			}
			const { embeddings, usage } = embedded;
			if (embeddings.length !== batch.length) {
				throw new Error(
					`Embedding count mismatch: expected ${batch.length}, got ${embeddings.length}`,
				);
			}
			// Providers occasionally omit usage: fall back to our own count
			attemptTokens +=
				usage.totalTokens > 0
					? usage.totalTokens
					: tokenCounts.slice(i, i + batch.length).reduce((s, n) => s + n, 0);

			const points: Point<VectorPayload>[] = [];
			const chunkRecords = batch.map((chunk, j) => {
				const chunkId = randomUUID();
				points.push({
					id: chunkId,
					vector: embeddings[j],
					payload: {
						documentId,
						chunkId,
						content: chunk.content,
						chunkIndex: chunk.index,
						userId,
						source: doc.source ?? undefined,
						metadata: cleanMetadata,
					},
				});
				return {
					id: chunkId,
					documentId,
					content: chunk.content,
					chunkIndex: chunk.index,
					tokenCount: tokenCounts[i + j],
					qdrantPointId: chunkId,
				};
			});

			await db.insert(documentChunk).values(chunkRecords);
			await upsertVectors(qdrant, collectionName, points);

			const batchNumber = i / INDEX_BATCH_SIZE + 1;
			await job.updateProgress(15 + Math.floor((batchNumber / totalBatches) * 75));
		}

		// Step 4: The document may have been deleted while we were embedding.
		// Its row (and chunks) are gone; remove the vectors that were just written.
		const [stillThere] = await db
			.select({ id: document.id })
			.from(document)
			.where(eq(document.id, documentId));
		if (!stillThere) {
			await deleteVectorsByFilter(qdrant, collectionName, {
				must: [{ key: "documentId", match: { value: documentId } }],
			});
		}

		// Step 5: Settle on the tokens actually embedded (including failed attempts)
		// and mark the document indexed in the same transaction as the settlement
		// marker. A failure here rolls both back and the retry settles once.
		const markIndexed = async (conn: Pick<typeof db, "update">) => {
			await conn
				.update(document)
				.set({ status: "indexed", chunkCount: chunks.length })
				.where(eq(document.id, documentId));
		};
		if (!settled) {
			await settle(
				paidBefore + attemptTokens,
				{ chunkCount: chunks.length },
				markIndexed,
			);
		} else {
			await markIndexed(db);
		}

		// Indexed and billed: now the older versions of this source can go
		if (stillThere && job.data.replaceSource)
			await replaceOlderDocuments(documentId, doc);

		await job.updateProgress(100);

		const processingTimeMs = Date.now() - startTime;
		console.log(
			`[Document Worker] Document ${documentId}: Indexed successfully in ${processingTimeMs}ms`,
		);

		return {
			documentId,
			chunkCount: stillThere ? chunks.length : 0,
			processingTimeMs,
		};
	} catch (error) {
		const terminal =
			error instanceof UnrecoverableError ||
			job.attemptsMade + 1 >= maxAttempts;
		const tokensPaid = paidBefore + attemptTokens;

		console.error(
			`[Document Worker] Document ${documentId}: Indexing failed (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
			describeError(error),
		);

		if (!terminal) {
			// Keep the reservation for the retry and remember what was already paid for
			await job
				.updateData({ ...job.data, embeddedTokens: tokensPaid, indexReplaced })
				.catch((err) =>
					console.error(
						`[Document Worker] Failed to persist embedded tokens for ${documentId}:`,
						describeError(err),
					),
				);
			throw error;
		}

		// Terminal failure: charge what the provider was paid for, refund the rest
		if (!settled) {
			try {
				reservation ??= await findReservation();
			} catch (err) {
				console.error(
					`[Document Worker] Failed to look up reservation for ${documentId}:`,
					describeError(err),
				);
			}
			await settle(tokensPaid, { failed: true }).catch((err) =>
				console.error(
					`[Document Worker] Failed to settle failed job ${documentId}:`,
					describeError(err),
				),
			);
		}

		// Never replaced the old index (e.g. credits refused): keep it
		if (!indexReplaced) {
			await markIndexingRefused(
				error instanceof UnrecoverableError
					? error.message
					: "Indexing failed before the previous index was replaced",
			);
			throw error;
		}

		// Remove partial output, then mark failed
		await deleteDocumentVectors(documentId).catch((cleanupErr) =>
			console.error(
				`[Document Worker] Failed to clean up Qdrant vectors for ${documentId}:`,
				describeError(cleanupErr),
			),
		);
		try {
			await db
				.delete(documentChunk)
				.where(eq(documentChunk.documentId, documentId));
			await markIndexingRefused(
				error instanceof UnrecoverableError
					? error.message
					: "Indexing failed. Try again or contact support.",
				{ chunkCount: 0 },
			);
		} catch (markErr) {
			console.error(
				`[Document Worker] Failed to mark ${documentId} as failed:`,
				describeError(markErr),
			);
		}

		throw error;
	}
}

/**
 * Process document deletion job
 */
async function processDeleteDocument(
	job: Job<DeleteDocumentJobData>,
): Promise<void> {
	const { documentId, userId } = job.data;

	console.log(
		`[Document Worker] Starting deletion for document: ${documentId}`,
	);

	// Delete from Qdrant first (every per-model collection)
	await deleteDocumentVectors(documentId);

	await job.updateProgress(50);

	// Delete from PostgreSQL (cascades to chunks)
	await db
		.delete(document)
		.where(and(eq(document.id, documentId), eq(document.userId, userId)));

	await job.updateProgress(100);

	console.log(`[Document Worker] Document ${documentId}: Deleted successfully`);
}

/**
 * Process document re-indexing job.
 * Indexing already clears old chunks and vectors, so re-indexing is the same run.
 */
async function processReindexDocument(
	job: Job<ReindexDocumentJobData>,
): Promise<IndexDocumentJobResult> {
	console.log(
		`[Document Worker] Starting re-indexing for document: ${job.data.documentId}`,
	);
	return processIndexDocument(job);
}

/**
 * Main job processor - routes to specific handlers based on job name
 */
async function processJob(
	job: Job<
		IndexDocumentJobData | DeleteDocumentJobData | ReindexDocumentJobData
	>,
	token?: string,
) {
	// One job at a time per document: concurrent index/reindex/delete jobs would
	// interleave their delete and insert steps.
	const lock = await acquireDocumentLock(job.data.documentId, redis);
	if (!lock) {
		// Re-delay without using up an attempt (the holder may run for minutes)
		console.log(
			`[Document Worker] Document ${job.data.documentId} is locked by another job, retrying job ${job.id} later`,
		);
		await job.moveToDelayed(Date.now() + LOCK_RETRY_DELAY_MS, token);
		throw new DelayedError();
	}

	try {
		switch (job.name) {
			case DocumentJobNames.INDEX:
				return await processIndexDocument(job as Job<IndexDocumentJobData>);
			case DocumentJobNames.DELETE:
				return await processDeleteDocument(job as Job<DeleteDocumentJobData>);
			case DocumentJobNames.REINDEX:
				return await processReindexDocument(job as Job<ReindexDocumentJobData>);
			default:
				throw new Error(`Unknown job name: ${job.name}`);
		}
	} finally {
		await lock.release();
	}
}

/**
 * Create and start the document worker
 */
export function createDocumentWorker() {
	const worker = new Worker(QUEUE_NAME, processJob, {
		connection: redisConnection,
		concurrency: 2,
		lockDuration: 1000 * 60 * 10, // 10 minutes for large documents
	});

	worker.on("completed", (job, result) => {
		console.log(
			`[Document Worker] Job ${job.id} (${job.name}) completed:`,
			result,
		);
	});

	worker.on("failed", (job, err) => {
		console.error(
			`[Document Worker] Job ${job?.id} (${job?.name}) failed:`,
			describeError(err),
		);
	});

	worker.on("error", (err) => {
		console.error("[Document Worker] Worker error:", describeError(err));
	});

	worker.on("stalled", (jobId) => {
		console.warn(`[Document Worker] Job ${jobId} stalled`);
	});

	console.log("[Document Worker] Worker started");

	return worker;
}
