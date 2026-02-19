import { Worker, Job } from "bullmq";
import { randomUUID } from "crypto";
import { db, document, documentChunk } from "@repo/db";
import {
	upsertVectors,
	deleteVectorsByFilter,
	type Point,
} from "@repo/qdrant";
import { eq } from "@repo/db/drizzle-orm";
import { OpenRouterEmbed } from "@repo/llm/openrouter";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { redisConnection } from "../connection";
import {
	type IndexDocumentJobData,
	type DeleteDocumentJobData,
	type ReindexDocumentJobData,
	type IndexDocumentJobResult,
	DocumentJobNames,
} from "./types";
import { chunkText, calculateTokens } from "../../services/chunking.service";
import { getProfile, getDefaultProfile } from "../../services/profile.service";
import {
	COLLECTION_NAME,
	qdrant,
	ensureCollection,
	type VectorPayload,
} from "../../services/qdrant.shared";

// Constants
const QUEUE_NAME = "document";
const EMBEDDING_BATCH_SIZE = 20; // Process embeddings in batches of 20

/**
 * Process document indexing job
 */
async function processIndexDocument(
	job: Job<IndexDocumentJobData>
): Promise<IndexDocumentJobResult> {
	const startTime = Date.now();
	const { documentId, content, source, metadata, chunkOptions, profileId } =
		job.data;

	console.log(
		`[Document Worker] Starting indexing for document: ${documentId} with profile: ${
			profileId || "default"
		}`
	);

	const profile = profileId
		? await getProfile(profileId)
		: await getDefaultProfile();
	const embeddingModelId =
		profile?.embeddingModel || "openai/text-embedding-3-small";

	const collectionName = await ensureCollection(embeddingModelId);

	// Update progress: Starting
	await job.updateProgress(5);

	try {
		// Step 1: Chunk the content
		const chunks = await chunkText(content, {
			chunkSize: chunkOptions?.chunkSize || profile?.chunkSize || 500,
			chunkOverlap: chunkOptions?.chunkOverlap || profile?.chunkOverlap || 50,
			separators: profile?.separators || undefined,
		});
		console.log(
			`[Document Worker] Document ${documentId}: Created ${chunks.length} chunks`
		);

		await job.updateProgress(20);

		// Step 2: Generate embeddings in batches (CRITICAL PERFORMANCE FIX)
		const embeddings: number[][] = [];
		const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);

		for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
			const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
			const batchTexts = batchChunks.map((c) => c.content);

			// Batch embedding call - single API request for multiple texts
			const batchEmbeddings = await OpenRouterEmbed(
				embeddingModelId,
				batchTexts
			);

			embeddings.push(...batchEmbeddings);

			// Update progress: 20% to 70% during embedding generation
			const batchNumber = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
			const progress = 20 + Math.floor((batchNumber / totalBatches) * 50);
			await job.updateProgress(progress);

			console.log(
				`[Document Worker] Document ${documentId}: Embedded batch ${batchNumber}/${totalBatches}`
			);
		}

		await job.updateProgress(75);

		// Step 3: Prepare vectors and chunk records
		const points: Point<VectorPayload>[] = [];
		const chunkRecords = chunks.map((chunk, index) => {
			const chunkId = randomUUID();

			points.push({
				id: chunkId,
				vector: embeddings[index],
				payload: {
					documentId,
					chunkId,
					content: chunk.content,
					chunkIndex: chunk.index,
					source,
					metadata,
				},
			});

			return {
				id: chunkId,
				documentId,
				content: chunk.content,
				chunkIndex: chunk.index,
				tokenCount: calculateTokens(
					chunk.content,
					"gpt-4o"
				),
				qdrantPointId: chunkId,
			};
		});

		await job.updateProgress(80);

		// Step 4: Insert chunk records into PostgreSQL
		if (chunkRecords.length > 0) {
			await db.insert(documentChunk).values(chunkRecords);
		}

		await job.updateProgress(90);

		// Step 5: Upsert vectors into Qdrant
		if (points.length > 0) {
			await upsertVectors(qdrant, collectionName, points);
		}

		await job.updateProgress(95);

		// Step 6: Update document status to indexed
		await db
			.update(document)
			.set({
				status: "indexed",
				chunkCount: chunks.length,
			})
			.where(eq(document.id, documentId));

		await job.updateProgress(100);

		const processingTimeMs = Date.now() - startTime;
		console.log(
			`[Document Worker] Document ${documentId}: Indexed successfully in ${processingTimeMs}ms`
		);

		return {
			documentId,
			chunkCount: chunks.length,
			processingTimeMs,
		};
	} catch (error) {
		// Clean up any chunk records that were inserted before failure
		await db
			.delete(documentChunk)
			.where(eq(documentChunk.documentId, documentId));

		// Mark document as failed
		await db
			.update(document)
			.set({ status: "failed" })
			.where(eq(document.id, documentId));

		console.error(
			`[Document Worker] Document ${documentId}: Indexing failed`,
			error
		);
		throw error;
	}
}

/**
 * Process document deletion job
 */
async function processDeleteDocument(
	job: Job<DeleteDocumentJobData>
): Promise<void> {
	const { documentId } = job.data;

	console.log(
		`[Document Worker] Starting deletion for document: ${documentId}`
	);

	// Delete from Qdrant first
	// We need to delete from ALL possible collections since we don't know which model was used
	// Or we find the document's model. Let's find the document.
	const [doc] = await db
		.select()
		.from(document)
		.where(eq(document.id, documentId));
	if (doc?.profileId) {
		const profile = await getProfile(doc.profileId);
		if (profile?.embeddingModel) {
			const model = OPENROUTER_EMBEDDING_MODELS.find(
				(m) => m.id === profile.embeddingModel
			);
			if (model) {
				const collectionName = `${COLLECTION_NAME}_${model.dimensions}`;
				await deleteVectorsByFilter(qdrant, collectionName, {
					must: [{ key: "documentId", match: { value: documentId } }],
				});
			}
		}
	} else {
		// Try default collection just in case
		const collectionName = `${COLLECTION_NAME}_1536`; // Default dimensions for small
		await deleteVectorsByFilter(qdrant, collectionName, {
			must: [{ key: "documentId", match: { value: documentId } }],
		});
	}

	await job.updateProgress(50);

	// Delete from PostgreSQL (cascades to chunks)
	await db.delete(document).where(eq(document.id, documentId));

	await job.updateProgress(100);

	console.log(`[Document Worker] Document ${documentId}: Deleted successfully`);
}

/**
 * Process document re-indexing job
 */
async function processReindexDocument(
	job: Job<ReindexDocumentJobData>
): Promise<IndexDocumentJobResult> {
	const { documentId, chunkOptions, profileId } = job.data;

	console.log(
		`[Document Worker] Starting re-indexing for document: ${documentId}`
	);

	// Get existing document
	const [doc] = await db
		.select()
		.from(document)
		.where(eq(document.id, documentId));

	if (!doc) {
		throw new Error(`Document not found: ${documentId}`);
	}

	await job.updateProgress(10);

	// Delete existing vectors
	// Similar deletion logic as processDeleteDocument
	if (doc.profileId) {
		const profile = await getProfile(doc.profileId);
		if (profile?.embeddingModel) {
			const model = OPENROUTER_EMBEDDING_MODELS.find(
				(m) => m.id === profile.embeddingModel
			);
			if (model) {
				const collectionName = `${COLLECTION_NAME}_${model.dimensions}`;
				await deleteVectorsByFilter(qdrant, collectionName, {
					must: [{ key: "documentId", match: { value: documentId } }],
				});
			}
		}
	} else {
		const collectionName = `${COLLECTION_NAME}_1536`;
		await deleteVectorsByFilter(qdrant, collectionName, {
			must: [{ key: "documentId", match: { value: documentId } }],
		});
	}

	// Delete existing chunks from PostgreSQL
	await db
		.delete(documentChunk)
		.where(eq(documentChunk.documentId, documentId));

	await job.updateProgress(20);

	// Update status to processing
	await db
		.update(document)
		.set({ status: "processing" })
		.where(eq(document.id, documentId));

	// Re-run indexing logic (reuse the index processor)
	const indexJob = {
		...job,
		data: {
			documentId,
			title: doc.title,
			content: doc.content,
			source: doc.source ?? undefined,
			metadata: doc.metadata ?? undefined,
			chunkOptions,
			profileId: profileId || doc.profileId || undefined,
		},
		updateProgress: async (progress: number) => {
			// Scale progress from 20-100 since we already used 0-20
			await job.updateProgress(20 + Math.floor(progress * 0.8));
		},
	} as Job<IndexDocumentJobData>;

	return processIndexDocument(indexJob);
}

/**
 * Main job processor - routes to specific handlers based on job name
 */
async function processJob(
	job: Job<
		IndexDocumentJobData | DeleteDocumentJobData | ReindexDocumentJobData
	>
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
		// Concurrency: how many jobs to process in parallel
		// Keep low for embedding jobs since they're API-bound
		concurrency: 2,
		// Lock duration: how long a job can run before considered stalled
		lockDuration: 1000 * 60 * 10, // 10 minutes for large documents
	});

	worker.on("completed", (job, result) => {
		console.log(
			`[Document Worker] Job ${job.id} (${job.name}) completed:`,
			result
		);
	});

	worker.on("failed", (job, err) => {
		console.error(
			`[Document Worker] Job ${job?.id} (${job?.name}) failed:`,
			err.message
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
