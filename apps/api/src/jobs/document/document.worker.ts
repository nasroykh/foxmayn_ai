import { Worker, Job, UnrecoverableError } from "bullmq";
import { randomUUID } from "crypto";
import { db, document, documentChunk, aiUsageLog } from "@repo/db";
import { upsertVectors, deleteVectorsByFilter, type Point } from "@repo/qdrant";
import { eq, and } from "@repo/db/drizzle-orm";
import { OpenRouterEmbed } from "@repo/llm/openrouter";
import { redisConnection } from "../connection";
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
} from "../../services/credits.service";
import { recordUsage } from "../../services/usage.service";
import { calculateCost, CREDIT_EPSILON } from "../../utils/cost";
import {
	DEFAULT_CHUNK_SIZE,
	DEFAULT_CHUNK_OVERLAP,
} from "../../utils/profile_schema";

// Constants
const QUEUE_NAME = "document";
// Chunks per embedding request, Postgres insert and Qdrant upsert
const INDEX_BATCH_SIZE = 64;
const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

/**
 * Index a document: chunk, embed, store chunks and vectors, bill.
 * Shared by the index and re-index jobs.
 *
 * - Idempotent: existing chunks and vectors of the document are removed first,
 *   so a retry or a crash recovery never duplicates them.
 * - Billing: the real chunk token counts are reserved up front. The reservation
 *   is keyed by job id, so a retry reuses it. It is settled on the tokens actually
 *   embedded, on success or on terminal failure.
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

	const settle = async (tokens: number, context: Record<string, unknown>) => {
		settled = true;
		const actualCost = calculateCost(embeddingModelId, tokens, 0);
		try {
			await settleReservation(
				reservation ?? {
					orgId: organizationId,
					userId,
					amount: 0,
					transactionId: "",
				},
				actualCost,
				`embedding ${documentId}`,
				usageId,
			);
		} catch (err) {
			// Never fail the job over billing; log everything needed to reconcile
			console.error(
				`[Document Worker] SETTLEMENT FAILED for ${documentId} (org ${organizationId}, reserved ${reservation?.amount ?? 0}, actual ${actualCost}):`,
				err,
			);
		}
		if (tokens > 0) {
			await recordUsage({
				id: usageId,
				organizationId,
				userId,
				operationType: "embedding",
				model: embeddingModelId,
				inputTokens: tokens,
				outputTokens: 0,
				costCredits: actualCost,
				metadata: { documentId, context: "document_indexing", ...context },
			});
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
			if (log) settled = true;
		}

		const profileId = job.data.profileId ?? doc.profileId;
		const profile =
			(profileId ? await getProfile(profileId, userId) : null) ??
			(await getDefaultProfile(userId));
		embeddingModelId = profile?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
		const collectionName = await ensureCollection(embeddingModelId);

		// Record the model first so searches only see the document through its own collection
		await db
			.update(document)
			.set({
				status: "processing",
				embeddingModel: embeddingModelId,
				chunkCount: 0,
			})
			.where(eq(document.id, documentId));

		// Idempotent start: drop whatever an earlier attempt or model left behind
		await deleteDocumentVectors(documentId);
		await db
			.delete(documentChunk)
			.where(eq(documentChunk.documentId, documentId));

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
					// Retrying cannot add credits
					throw new UnrecoverableError(
						err instanceof Error ? err.message : "Insufficient credits",
					);
				}
			}
		}

		// Step 3: Embed, then store chunks and vectors, batch by batch
		const totalBatches = Math.ceil(chunks.length / INDEX_BATCH_SIZE);
		for (let i = 0; i < chunks.length; i += INDEX_BATCH_SIZE) {
			const batch = chunks.slice(i, i + INDEX_BATCH_SIZE);

			const { embeddings, usage } = await OpenRouterEmbed(
				embeddingModelId,
				batch.map((c) => c.content),
			);
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
						metadata: doc.metadata ?? undefined,
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
		if (!settled) {
			await settle(paidBefore + attemptTokens, {
				chunkCount: chunks.length,
			});
		}

		// Step 6: Mark indexed
		await db
			.update(document)
			.set({ status: "indexed", chunkCount: chunks.length })
			.where(eq(document.id, documentId));

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
			error,
		);

		if (!terminal) {
			// Keep the reservation for the retry and remember what was already paid for
			await job
				.updateData({ ...job.data, embeddedTokens: tokensPaid })
				.catch((err) =>
					console.error(
						`[Document Worker] Failed to persist embedded tokens for ${documentId}:`,
						err,
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
					err,
				);
			}
			await settle(tokensPaid, { failed: true }).catch((err) =>
				console.error(
					`[Document Worker] Failed to settle failed job ${documentId}:`,
					err,
				),
			);
		}

		// Remove partial output, then mark failed
		await deleteDocumentVectors(documentId).catch((cleanupErr) =>
			console.error(
				`[Document Worker] Failed to clean up Qdrant vectors for ${documentId}:`,
				cleanupErr,
			),
		);
		try {
			await db
				.delete(documentChunk)
				.where(eq(documentChunk.documentId, documentId));
			await db
				.update(document)
				.set({ status: "failed", chunkCount: 0 })
				.where(eq(document.id, documentId));
		} catch (markErr) {
			console.error(
				`[Document Worker] Failed to mark ${documentId} as failed:`,
				markErr,
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
) {
	switch (job.name) {
		case DocumentJobNames.INDEX:
			return processIndexDocument(job as Job<IndexDocumentJobData>);
		case DocumentJobNames.DELETE:
			return processDeleteDocument(job as Job<DeleteDocumentJobData>);
		case DocumentJobNames.REINDEX:
			return processReindexDocument(job as Job<ReindexDocumentJobData>);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
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
			err.message,
		);
	});

	worker.on("error", (err) => {
		console.error("[Document Worker] Worker error:", err);
	});

	worker.on("stalled", (jobId) => {
		console.warn(`[Document Worker] Job ${jobId} stalled`);
	});

	console.log("[Document Worker] Worker started");

	return worker;
}
