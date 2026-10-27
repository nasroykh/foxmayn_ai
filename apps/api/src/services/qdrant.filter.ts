import type { Schemas } from "@repo/qdrant";

/**
 * Build the Qdrant filter for chunk searches.
 * The owner (`userId`) is mandatory and always a `must` condition, so a search
 * can never return chunks that belong to another user.
 */
export const buildChunkFilter = (options: {
	userId: string;
	documentId?: string;
	source?: string;
}): Schemas["Filter"] => {
	const { userId, documentId, source } = options;
	if (!userId) throw new Error("userId is required to scope Qdrant filters");

	const must: Array<{ key: string; match: { value: string } }> = [
		{ key: "userId", match: { value: userId } },
	];
	if (documentId) must.push({ key: "documentId", match: { value: documentId } });
	if (source) must.push({ key: "source", match: { value: source } });

	return { must };
};

/**
 * True when `name` is a per-dimension vector collection (`<base>_<dims>`).
 */
export const isVectorCollection = (name: string, base: string): boolean =>
	name.startsWith(`${base}_`) && /^\d+$/.test(name.slice(base.length + 1));
