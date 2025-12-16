import { db, document } from "@repo/db";
import {
	createQdrantClient,
	createCollection,
	searchVectors,
} from "@repo/qdrant";
import { eq } from "@repo/db/drizzle-orm";
import { nanoid } from "nanoid";
import type { ChunkOptions } from "./chunking.service";
import { OpenRouterEmbed, OpenRouterQuery } from "../utils/openrouter";
import { env } from "../config/env";
import {
	addIndexDocumentJob,
	addDeleteDocumentJob,
	getDocumentJobStatus,
} from "../jobs";

// Constants
const COLLECTION_NAME = env.QDRANT_COLLECTION_NAME || "foxmayn_ai";
const VECTOR_SIZE = 1536;

// Initialize Qdrant client
const qdrant = createQdrantClient({ url: env.QDRANT_URL });

// Collection initialization flag
let collectionInitialized = false;

const ensureCollection = async () => {
	if (collectionInitialized) return;

	await createCollection(qdrant, COLLECTION_NAME, {
		size: VECTOR_SIZE,
		distance: "Cosine",
		keywordFields: ["documentId", "source"],
		textFields: ["content"],
	});

	collectionInitialized = true;
};

// Payload type for Qdrant vectors
interface VectorPayload extends Record<string, unknown> {
	documentId: string;
	chunkId: string;
	content: string;
	chunkIndex: number;
	source?: string;
	metadata?: Record<string, unknown>;
}

// Types
export interface IndexDocumentOptions {
	title: string;
	content: string;
	source?: string;
	metadata?: Record<string, unknown>;
	chunkOptions?: ChunkOptions;
}

export interface QueryOptions {
	limit?: number;
	scoreThreshold?: number;
	filter?: {
		documentId?: string;
		source?: string;
	};
}

export interface QueryResult {
	answer: string;
	sources: Array<{
		documentId: string;
		chunkId: string;
		content: string;
		score: number;
	}>;
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
export const indexDocument = async (
	options: IndexDocumentOptions
): Promise<{ documentId: string; jobId: string | undefined }> => {
	const { title, content, source, metadata, chunkOptions } = options;

	const docId = nanoid();

	// Create document record with status "processing"
	await db.insert(document).values({
		id: docId,
		title,
		content,
		source,
		metadata,
		status: "processing",
	});

	// Add job to queue - returns immediately
	const { jobId } = await addIndexDocumentJob({
		documentId: docId,
		title,
		content,
		source,
		metadata,
		chunkOptions,
	});

	return { documentId: docId, jobId };
};

/**
 * Get the status of a document indexing job
 */
export const getIndexingStatus = async (jobId: string) => {
	return getDocumentJobStatus(jobId);
};

/**
 * Search for relevant chunks
 */
export const searchChunks = async (
	query: string,
	options: QueryOptions = {}
): Promise<SearchResult[]> => {
	const { limit = 5, scoreThreshold = 0.7, filter } = options;

	await ensureCollection();

	// Generate query embedding
	const embedding = await OpenRouterEmbed("openaiTextEmbedding3Small", query);

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
	const results = await searchVectors(qdrant, COLLECTION_NAME, embedding, {
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
 * Query the RAG system
 */
export const queryRAG = async (
	query: string,
	options: QueryOptions = {}
): Promise<QueryResult> => {
	const searchResults = await searchChunks(query, options);

	if (searchResults.length === 0) {
		return {
			answer:
				"I couldn't find any relevant information to answer your question.",
			sources: [],
		};
	}

	// Build context from search results
	const context = searchResults
		.map((r, i) => `[${i + 1}] ${r.content}`)
		.join("\n\n");

	const systemPrompt = `You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information to answer the question, say so clearly. Do not make up information.

Context:
${context}

Instructions:
- Use only the information from the context above
- Cite sources using [number] notation when referencing specific context
- Be concise and accurate
- If uncertain, express your uncertainty`;

	// Generate answer
	const answer = await OpenRouterQuery(
		{
			model: "gemini25FlashLite",
			temperature: 0,
			maxTokens: 2048,
			reasoningEffort: "minimal",
			stream: false,
		},
		undefined,
		systemPrompt,
		query
	);

	return {
		answer: answer as string,
		sources: searchResults,
	};
};

/**
 * Query the RAG system with streaming
 */
export async function* queryRAGStream(
	query: string,
	options: QueryOptions = {}
): AsyncGenerator<
	| { type: "sources"; data: SearchResult[] }
	| { type: "token"; data: string }
	| { type: "done" },
	void,
	unknown
> {
	const searchResults = await searchChunks(query, options);

	// Yield sources first
	yield { type: "sources", data: searchResults };

	if (searchResults.length === 0) {
		yield {
			type: "token",
			data: "I couldn't find any relevant information to answer your question.",
		};
		yield { type: "done" };
		return;
	}

	// Build context from search results
	const context = searchResults
		.map((r, i) => `[${i + 1}] ${r.content}`)
		.join("\n\n");

	const systemPrompt = `You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information to answer the question, say so clearly. Do not make up information.

Context:
${context}

Instructions:
- Use only the information from the context above
- Cite sources using [number] notation when referencing specific context
- Be concise and accurate
- If uncertain, express your uncertainty`;

	// Generate streaming answer
	const stream = await OpenRouterQuery(
		{
			model: "gemini25FlashLite",
			temperature: 0,
			maxTokens: 2048,
			reasoningEffort: "minimal",
			stream: true,
		},
		undefined,
		systemPrompt,
		query
	);

	// Handle streaming response
	if (typeof stream !== "string" && Symbol.asyncIterator in stream) {
		for await (const chunk of stream) {
			const content = chunk.choices[0]?.delta?.content;
			if (content) {
				yield { type: "token", data: content };
			}
		}
	}

	yield { type: "done" };
}

/**
 * Delete a document and its vectors (ASYNC - via background job)
 */
export const deleteDocument = async (
	documentId: string
): Promise<{ jobId: string | undefined }> => {
	const { jobId } = await addDeleteDocumentJob({ documentId });
	return { jobId };
};

/**
 * Get document by ID
 */
export const getDocument = async (documentId: string) => {
	const [doc] = await db
		.select()
		.from(document)
		.where(eq(document.id, documentId));

	return doc || null;
};

/**
 * List documents
 */
export const listDocuments = async (limit = 20, offset = 0) => {
	const docs = await db.select().from(document).limit(limit).offset(offset);
	return docs;
};