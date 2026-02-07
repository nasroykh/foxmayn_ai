import { createQdrantClient, createCollection } from "@repo/qdrant";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { env } from "../config/env";

// Constants
export const COLLECTION_NAME = env.QDRANT_COLLECTION_NAME || "foxmayn_ai";

// Initialize Qdrant client
export const qdrant = createQdrantClient({ url: env.QDRANT_URL });

// Collection initialization map to handle multiple embedding models (dimensions)
export const initializedCollections = new Set<string>();

export const ensureCollection = async (modelId: string) => {
	const model = OPENROUTER_EMBEDDING_MODELS.find((m) => m.id === modelId);
	if (!model) {
		throw new Error(`Embedding model not found: ${modelId}`);
	}

	const collectionName = `${COLLECTION_NAME}_${model.dimensions}`;

	if (initializedCollections.has(collectionName)) return collectionName;

	await createCollection(qdrant, collectionName, {
		size: model.dimensions,
		distance: "Cosine",
		keywordFields: ["documentId", "source"],
		textFields: ["content"],
	});

	initializedCollections.add(collectionName);
	return collectionName;
};

// Payload type for Qdrant vectors
export interface VectorPayload extends Record<string, unknown> {
	documentId: string;
	chunkId: string;
	content: string;
	chunkIndex: number;
	source?: string;
	metadata?: Record<string, unknown>;
}
