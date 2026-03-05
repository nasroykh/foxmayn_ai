import { randomUUID } from "node:crypto";
import { db, document, documentChunk, aiUsageLog } from "@repo/db";
import { searchVectors } from "@repo/qdrant";
import { eq, and, count } from "@repo/db/drizzle-orm";
import {
	OpenRouterQuery,
	OpenRouterEmbed,
	type AIUsage,
} from "@repo/llm/openrouter";
import { getProfile, getDefaultProfile } from "./profile.service";
import {
	addIndexDocumentJob,
	addDeleteDocumentJob,
	getDocumentJobStatus,
} from "../jobs";
import { parseDocx, parseHTML, parsePDF, parseXlsx } from "../utils/parsers";
import { ORPCError } from "@orpc/server";
import { GET_MAIN_SYSTEM_PROMPT } from "../utils/system_prompts";
import { qdrant, ensureCollection, type VectorPayload } from "./qdrant.shared";
import { logUsageAndDeduct } from "./usage.service";
import { deductCredits, addCredits } from "./credits.service";
import { estimateChatCost, calculateCost } from "../utils/cost";

const ALLOWED_FILE_TYPES = [
	"text/plain",
	"text/markdown",
	// "text/csv",
	// "application/json",
	// "application/xml",
	"text/html",
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	// "application/vnd.ms-excel",
	// "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Types
export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface QueryOptions {
	limit?: number;
	scoreThreshold?: number;
	profileId?: string;
	messages?: ChatMessage[];
	filter?: {
		documentId?: string;
		source?: string;
	};
	// Usage tracking context
	organizationId?: string;
	userId?: string;
}

export interface QueryResult {
	answer: string;
	sources: Array<{
		documentId: string;
		chunkId: string;
		content: string;
		score: number;
	}>;
	usage?: AIUsage;
}

export interface SearchResult {
	documentId: string;
	chunkId: string;
	content: string;
	score: number;
}

/**
 * Index a document into the RAG system (ASYNC - via background job)
 *
 * This now returns immediately with a jobId. The actual indexing
 * happens in a background worker process.
 *
 * @returns documentId and jobId for tracking
 */
export const indexDocument = async (options: {
	file: File;
	title?: string;
	source?: string;
	profileId?: string;
	metadata?: Record<string, unknown>;
	userId: string;
	organizationId?: string;
}): Promise<{ documentId: string; jobId: string | undefined }> => {
	const { file, title, source, profileId, metadata, userId, organizationId } =
		options;

	if (!file || !file.name || !file.type)
		throw new ORPCError("BAD_REQUEST", {
			message: "File is required",
		});

	// Validate file extension
	if (!ALLOWED_FILE_TYPES.includes(file.type))
		throw new ORPCError("BAD_REQUEST", {
			message: "Invalid file type.",
			data: {
				allowedFileTypes: ALLOWED_FILE_TYPES,
			},
		});

	if (file.size > MAX_FILE_SIZE)
		throw new ORPCError("BAD_REQUEST", {
			message: "File too large (max 10MB)",
		});

	const content = await extractTextFromDocument(file);

	if (!content?.trim())
		throw new ORPCError("BAD_REQUEST", {
			message: "File is empty",
		});

	const documentId = randomUUID();
	const docTitle = title || file.name || "Untitled";

	// Create document record with status "processing"
	await db.insert(document).values({
		id: documentId,
		userId,
		profileId,
		title: docTitle,
		content,
		source,
		metadata,
		status: "processing",
	});

	// Add job to queue - returns immediately
	// Pass organizationId so the worker can track usage
	const { jobId } = await addIndexDocumentJob({
		documentId,
		title: docTitle,
		content,
		source,
		metadata,
		profileId,
		organizationId,
		userId,
	});

	return { documentId, jobId };
};

/**
 * Get the status of a document indexing job
 */
export const getIndexingStatus = async (jobId: string) => {
	return getDocumentJobStatus(jobId);
};

/**
 * Search for relevant chunks.
 * Logs embedding usage if organizationId is provided.
 */
export const searchChunks = async (
	query: string,
	options: QueryOptions = {},
): Promise<SearchResult[]> => {
	const { profileId, filter, organizationId, userId } = options;

	// Load profile or use default
	const profile = profileId
		? await getProfile(profileId)
		: await getDefaultProfile();

	const embeddingModelId =
		profile?.embeddingModel || "openai/text-embedding-3-small";
	const limit = options.limit || profile?.topK || 5;
	const scoreThreshold =
		options.scoreThreshold || profile?.scoreThreshold || 0.3;

	const collectionName = await ensureCollection(embeddingModelId);

	// Early exit: if no chunks are indexed yet, skip the embedding API call entirely.
	const [chunkCount] = await db
		.select({ count: count() })
		.from(documentChunk)
		.innerJoin(document, eq(documentChunk.documentId, document.id))
		.where(
			filter?.documentId
				? eq(document.id, filter.documentId)
				: eq(document.status, "indexed"),
		);
	if ((chunkCount?.count ?? 0) === 0) return [];

	// Generate query embedding — now returns usage data
	const { embeddings, usage: embedUsage } = await OpenRouterEmbed(
		embeddingModelId,
		[query],
	);

	// Log embedding usage if org context is available
	if (organizationId && userId) {
		await logUsageAndDeduct({
			organizationId,
			userId,
			operationType: "embedding",
			model: embeddingModelId,
			inputTokens: embedUsage.totalTokens,
			outputTokens: 0,
			metadata: { context: "search_query" },
		});
	}

	// Build filter
	let qdrantFilter = undefined;
	if (filter?.documentId || filter?.source) {
		const must: Array<{ key: string; match: { value: string } }> = [];

		if (filter.documentId) {
			must.push({ key: "documentId", match: { value: filter.documentId } });
		}
		if (filter.source) {
			must.push({ key: "source", match: { value: filter.source } });
		}

		qdrantFilter = { must };
	}

	// Search Qdrant
	const results = await searchVectors(qdrant, collectionName, embeddings[0], {
		limit,
		scoreThreshold,
		filter: qdrantFilter,
	});

	return results.map((r) => {
		const payload = r.payload as unknown as VectorPayload;
		return {
			documentId: payload.documentId,
			chunkId: payload.chunkId,
			content: payload.content,
			score: r.score,
		};
	});
};

/**
 * Query the RAG system (non-streaming).
 * Tracks usage and deducts credits.
 */
export const queryRAG = async (
	query: string,
	options: QueryOptions = {},
): Promise<QueryResult> => {
	const profile = options.profileId
		? await getProfile(options.profileId)
		: await getDefaultProfile();

	const searchResults = await searchChunks(query, options);

	// Build context from search results
	const context = searchResults
		.map((r, i) => `[${i + 1}] ${r.content}`)
		.join("\n\n");

	const systemPrompt = GET_MAIN_SYSTEM_PROMPT({
		context,
		assistantName: profile?.assistantName || "Assistant",
		companyName: profile?.companyName || undefined,
		tone: profile?.tone || "friendly",
		domain: profile?.domain || undefined,
		enableCitations: profile?.enableCitations ?? true,
		responseLength: profile?.responseLength || "balanced",
		language: profile?.language || "English",
		customInstructions: profile?.customInstructions || [],
	});

	const modelId = profile?.model || "google/gemini-2.5-flash-lite";

	// Generate answer — now returns text + usage
	const result = await OpenRouterQuery(
		{
			model: modelId,
			temperature: profile?.temperature ?? 1.0,
			topP: profile?.topP,
			maxTokens: profile?.maxTokens ?? 2048,
			reasoning: (profile?.reasoningEffort as "none") || "none",
			stream: false,
		},
		options.messages,
		systemPrompt,
		query,
	);

	// Log chat usage if org context is available
	if (options.organizationId && options.userId) {
		await logUsageAndDeduct({
			organizationId: options.organizationId,
			userId: options.userId,
			operationType: "chat",
			model: modelId,
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			metadata: { context: "query" },
		});
	}

	return {
		answer: result.text,
		sources: searchResults,
		usage: result.usage,
	};
};

/**
 * Query the RAG system with streaming.
 * Tracks usage after stream completes.
 */
export async function* queryRAGStream(
	query: string,
	options: QueryOptions = {},
): AsyncGenerator<
	| { type: "sources"; data: SearchResult[] }
	| { type: "token"; data: string }
	| { type: "usage"; data: AIUsage }
	| { type: "done" },
	void,
	unknown
> {
	const profile = options.profileId
		? await getProfile(options.profileId)
		: await getDefaultProfile();

	const searchResults = await searchChunks(query, options);

	// Yield sources first
	yield { type: "sources", data: searchResults };

	// if (searchResults.length === 0) {
	// 	yield {
	// 		type: "token",
	// 		data: "I couldn't find any relevant information to answer your question.",
	// 	};
	// 	yield { type: "done" };
	// 	return;
	// }

	// Build context from search results
	const context = searchResults
		.map((r, i) => `[${i + 1}] ${r.content}`)
		.join("\n\n");

	const systemPrompt =
		profile?.systemPrompt ||
		GET_MAIN_SYSTEM_PROMPT({
			context,
			assistantName: profile?.assistantName || "Assistant",
			companyName: profile?.companyName || undefined,
			tone: profile?.tone || "friendly",
			domain: profile?.domain || undefined,
			enableCitations: profile?.enableCitations ?? true,
			responseLength: profile?.responseLength || "balanced",
			language: profile?.language || "English",
			customInstructions: profile?.customInstructions || [],
		});

	const modelId = profile?.model || "google/gemini-2.5-flash-lite";

	// Generate streaming answer — now returns stream + getUsage()
	const { stream, getUsage } = OpenRouterQuery(
		{
			model: modelId,
			temperature: profile?.temperature ?? 1.0,
			topP: profile?.topP,
			maxTokens: profile?.maxTokens ?? 2048,
			reasoning: (profile?.reasoningEffort as "none") || "none",
			stream: true,
		},
		options.messages,
		systemPrompt,
		query,
	);

	// Pre-authorize: estimate cost and reserve credits before streaming begins.
	// This prevents users from receiving free AI when their balance is drained by concurrent ops.
	let reservationId: string | null = null;
	let estimatedCost = 0;

	if (options.organizationId && options.userId) {
		estimatedCost = estimateChatCost(modelId, query.length, 500);
		if (estimatedCost > 0) {
			const reservation = await deductCredits({
				orgId: options.organizationId,
				amount: estimatedCost,
				description: `chat reservation — ${modelId}`,
				userId: options.userId,
			});

			if (!reservation) {
				throw new ORPCError("FORBIDDEN", {
					message: "Insufficient credits to start this request",
				});
			}
			reservationId = reservation.transactionId;
		}
	}

	// Stream tokens
	let streamError: unknown = null;
	try {
		for await (const delta of stream) {
			if (delta) {
				yield { type: "token", data: delta };
			}
		}
	} catch (err) {
		streamError = err;
	}

	// After stream completes (or errors), get actual usage and settle
	const usage = await getUsage();
	yield { type: "usage", data: usage };

	if (options.organizationId && options.userId && reservationId) {
		if (streamError) {
			// Stream failed — refund full reservation
			await addCredits({
				orgId: options.organizationId,
				amount: estimatedCost,
				type: "refund",
				description: `chat reservation refund — stream error`,
				referenceId: reservationId,
				userId: options.userId,
			}).catch((err) =>
				console.error(
					"[Usage] Failed to refund reservation after stream error:",
					err,
				),
			);
		} else {
			// Settle: calculate actual cost and adjust
			const actualCost = calculateCost(
				modelId,
				usage.inputTokens,
				usage.outputTokens,
			);
			const diff = estimatedCost - actualCost;

			if (diff > 0.000001) {
				// Refund the over-charged amount
				await addCredits({
					orgId: options.organizationId,
					amount: diff,
					type: "adjustment",
					description: `chat settlement refund — ${modelId}`,
					referenceId: reservationId,
					userId: options.userId,
				}).catch((err) =>
					console.error(
						"[Usage] Failed to refund over-charged reservation:",
						err,
					),
				);
			} else if (diff < -0.000001) {
				// Charge the under-charged amount (small, allow failure)
				await deductCredits({
					orgId: options.organizationId,
					amount: -diff,
					description: `chat settlement charge — ${modelId}`,
					referenceId: reservationId,
					userId: options.userId,
				}).catch((err) =>
					console.error(
						"[Usage] Failed to charge under-charged settlement:",
						err,
					),
				);
			}

			// Insert usage log (credits already settled above — no additional deduction)
			await db
				.insert(aiUsageLog)
				.values({
					id: randomUUID(),
					organizationId: options.organizationId,
					userId: options.userId,
					operationType: "chat",
					model: modelId,
					inputTokens: usage.inputTokens,
					outputTokens: usage.outputTokens,
					totalTokens: usage.inputTokens + usage.outputTokens,
					costCredits: actualCost.toString(),
					metadata: { context: "query_stream" },
				})
				.catch((err) =>
					console.error(
						"[Usage] Failed to insert usage log after settlement:",
						err,
					),
				);
		}
	}

	if (streamError) throw streamError;

	yield { type: "done" };
}

/**
 * Delete a document and its vectors (ASYNC - via background job)
 */
export const deleteDocument = async (
	documentId: string,
): Promise<{ jobId: string | undefined }> => {
	const { jobId } = await addDeleteDocumentJob({ documentId });
	return { jobId };
};

/**
 * Get document by ID (scoped to user)
 */
export const getDocument = async (documentId: string, userId?: string) => {
	const conditions = [eq(document.id, documentId)];
	if (userId) conditions.push(eq(document.userId, userId));

	const [doc] = await db
		.select()
		.from(document)
		.where(and(...conditions));

	return doc || null;
};

/**
 * List documents (scoped to user)
 */
export const listDocuments = async (
	limit = 20,
	offset = 0,
	userId?: string,
) => {
	if (userId) {
		return await db
			.select()
			.from(document)
			.where(eq(document.userId, userId))
			.limit(limit)
			.offset(offset);
	}
	return await db.select().from(document).limit(limit).offset(offset);
};

/**
 * Count total documents (scoped to user)
 */
export const countDocuments = async (userId?: string) => {
	if (userId) {
		const [result] = await db
			.select({ count: count() })
			.from(document)
			.where(eq(document.userId, userId));
		return result?.count ?? 0;
	}
	const [result] = await db.select({ count: count() }).from(document);
	return result?.count ?? 0;
};

export const extractTextFromDocument = async (file: File) => {
	const { type } = file;

	switch (type) {
		case "text/html": {
			return parseHTML(await file.text());
		}
		case "application/pdf": {
			const pdfBuffer = await file.arrayBuffer();
			return await parsePDF(Buffer.from(pdfBuffer));
		}
		case "application/msword":
		case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
			const docxBuffer = await file.arrayBuffer();
			return await parseDocx(Buffer.from(docxBuffer));
		}
		case "application/vnd.ms-excel":
		case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
			const xlsxBuffer = await file.arrayBuffer();
			return parseXlsx(Buffer.from(xlsxBuffer));
		}
		case "text/plain":
		case "text/markdown": {
			return await file.text();
		}
		default:
			throw new Error("Unsupported file type");
	}
};
