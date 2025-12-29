import { randomUUID } from "node:crypto";
import { db, document } from "@repo/db";
import {
	createQdrantClient,
	createCollection,
	searchVectors,
} from "@repo/qdrant";
import { eq } from "@repo/db/drizzle-orm";
import type { ChunkOptions } from "./chunking.service";
import {
	OPENROUTER_EMBEDDING_MODELS,
	OpenRouterEmbed,
	OpenRouterQuery,
} from "../utils/openrouter";
import { env } from "../config/env";
import {
	addIndexDocumentJob,
	addDeleteDocumentJob,
	getDocumentJobStatus,
} from "../jobs";
import { parseDocx, parseHTML, parsePDF, parseXlsx } from "../utils/parsers";
import { ORPCError } from "@orpc/server";

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

// Constants
const COLLECTION_NAME = env.QDRANT_COLLECTION_NAME || "foxmayn_ai";
const SELECTED_EMBEDDING_MODEL = OPENROUTER_EMBEDDING_MODELS.find(
	(m) => m.id === "qwen/qwen3-embedding-8b"
);

// Initialize Qdrant client
const qdrant = createQdrantClient({ url: env.QDRANT_URL });

// Collection initialization flag
let collectionInitialized = false;

const ensureCollection = async () => {
	if (collectionInitialized) return;

	if (!SELECTED_EMBEDDING_MODEL) {
		throw new Error("Selected embedding model not found");
	}

	await createCollection(qdrant, COLLECTION_NAME, {
		size: SELECTED_EMBEDDING_MODEL.dimensions,
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
export const indexDocument = async (options: {
	file: File;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
}): Promise<{ documentId: string; jobId: string | undefined }> => {
	const { file, title, source, metadata } = options;

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
		title: docTitle,
		content,
		source,
		metadata,
		status: "processing",
	});

	// Add job to queue - returns immediately
	const { jobId } = await addIndexDocumentJob({
		documentId,
		title: docTitle,
		content,
		source,
		metadata,
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
 * Search for relevant chunks
 */
export const searchChunks = async (
	query: string,
	options: QueryOptions = {}
): Promise<SearchResult[]> => {
	const { limit = 5, scoreThreshold = 0.7, filter } = options;

	await ensureCollection();

	// Generate query embedding
	const embedding = await OpenRouterEmbed("qwen/qwen3-embedding-8b", query);

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
			model: "google/gemini-2.5-flash-lite",
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
			model: "google/gemini-2.5-flash-lite",
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
