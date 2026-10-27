import {
	createQdrantClient,
	createCollection,
	deleteVectorsByFilter,
	ensureKeywordIndex,
	getCollectionInfo,
	listCollectionNames,
} from "@repo/qdrant";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { env } from "../config/env";
import { ORPCError } from "@orpc/server";
import { collectionNameForModel, isVectorCollection } from "./qdrant.filter";

// Constants
export const COLLECTION_NAME = env.QDRANT_COLLECTION_NAME || "foxmayn_ai";

// Initialize Qdrant client
export const qdrant = createQdrantClient({ url: env.QDRANT_URL });

// Collections already verified in this process (one per embedding model)
export const initializedCollections = new Set<string>();

const KEYWORD_FIELDS = ["documentId", "source", "userId"];

// Concurrent first-time requests race on create-if-missing: the loser gets a 409
const isAlreadyExistsError = (err: unknown): boolean => {
	const e = err as { status?: number; message?: string } | null;
	return e?.status === 409 || /already exists/i.test(e?.message ?? "");
};

const vectorSizeOf = (
	info: Awaited<ReturnType<typeof getCollectionInfo>>,
): number | undefined => {
	const vectors = info?.config.params.vectors;
	if (!vectors || !("size" in vectors)) return undefined;
	return typeof vectors.size === "number" ? vectors.size : undefined;
};

/**
 * Create the collection for an embedding model if it does not exist yet.
 * Collections are keyed by model id (see `collectionNameForModel`).
 */
export const ensureCollection = async (modelId: string) => {
	const model = OPENROUTER_EMBEDDING_MODELS.find((m) => m.id === modelId);
	if (!model) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Unknown embedding model: ${modelId}`,
		});
	}

	const collectionName = collectionNameForModel(COLLECTION_NAME, model.id);

	if (initializedCollections.has(collectionName)) return collectionName;

	try {
		await createCollection(qdrant, collectionName, {
			size: model.dimensions,
			distance: "Cosine",
			keywordFields: KEYWORD_FIELDS,
			textFields: ["content"],
		});
	} catch (err) {
		if (!isAlreadyExistsError(err)) throw err;
		// Another process created it first; make sure the indexes exist (idempotent)
		for (const field of KEYWORD_FIELDS) {
			await ensureKeywordIndex(qdrant, collectionName, field);
		}
	}

	// Collections created before `userId` was stored lack its index (no-op if present)
	await ensureKeywordIndex(qdrant, collectionName, "userId");

	// An existing collection must match the model's dimensions
	const size = vectorSizeOf(await getCollectionInfo(qdrant, collectionName));
	if (size !== undefined && size !== model.dimensions) {
		throw new Error(
			`Collection ${collectionName} has ${size} dimensions, ${model.id} needs ${model.dimensions}`,
		);
	}

	initializedCollections.add(collectionName);
	return collectionName;
};

/**
 * Delete every vector of a document from all per-model collections.
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
