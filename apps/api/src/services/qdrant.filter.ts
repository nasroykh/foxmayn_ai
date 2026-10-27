import type { Schemas } from "@repo/qdrant";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";

/**
 * Build the Qdrant filter for chunk searches.
 * The owner (`userId`) is mandatory and always a `must` condition, so a search
 * can never return chunks that belong to another user.
 */
export const buildChunkFilter = (options: {
	userId: string;
	documentId?: string;
	/** Limit to these documents (a knowledge base). An empty list matches nothing. */
	documentIds?: string[];
	source?: string;
}): Schemas["Filter"] => {
	const { userId, documentId, documentIds, source } = options;
	if (!userId) throw new Error("userId is required to scope Qdrant filters");

	const must: Array<
		| { key: string; match: { value: string } }
		| { key: string; match: { any: string[] } }
	> = [{ key: "userId", match: { value: userId } }];
	if (documentId) must.push({ key: "documentId", match: { value: documentId } });
	if (documentIds) must.push({ key: "documentId", match: { any: documentIds } });
	if (source) must.push({ key: "source", match: { value: source } });

	return { must };
};

/**
 * Collection name for an embedding model: `<base>_<slug(model)>`.
 * Collections are keyed by model, not by dimensions: two models can share a
 * dimension (text-embedding-3-large and gemini-embedding-001 are both 3072)
 * but their vector spaces are not comparable.
 */
export const collectionNameForModel = (base: string, modelId: string): string =>
	`${base}_${modelId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;

/**
 * True when `name` is a vector collection created by this app for `base`
 * (one of the known embedding models).
 */
export const isVectorCollection = (name: string, base: string): boolean =>
	OPENROUTER_EMBEDDING_MODELS.some(
		(m) => collectionNameForModel(base, m.id) === name,
	);
