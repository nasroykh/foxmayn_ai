import {
	createQdrantClient,
	createCollection,
	deleteVectorsByFilter,
	ensureKeywordIndex,
	listCollectionNames,
} from "@repo/qdrant";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { env } from "../config/env";
import { isVectorCollection } from "./qdrant.filter";

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
		keywordFields: ["documentId", "source", "userId"],
		textFields: ["content"],
	});

	// Collections created before `userId` was stored lack its index (no-op if present)
	await ensureKeywordIndex(qdrant, collectionName, "userId");

	initializedCollections.add(collectionName);
	return collectionName;
};

/**
 * Delete every vector of a document from all `<COLLECTION_NAME>_<dims>` collections.
 * A document may live in any of them, depending on the embedding model of its profile.
 */
export const deleteDocumentVectors = async (documentId: string) => {
	const names = await listCollectionNames(qdrant);
	for (const name of names.filter((n) => isVectorCollection(n, COLLECTION_NAME))) {
		await deleteVectorsByFilter(qdrant, name, {
			must: [{ key: "documentId", match: { value: documentId } }],
		});
	}
};

// Payload type for Qdrant vectors
export interface VectorPayload extends Record<string, unknown> {
	documentId: string;
	chunkId: string;
	content: string;
	chunkIndex: number;
	userId: string;
	source?: string;
	metadata?: Record<string, unknown>;
}
