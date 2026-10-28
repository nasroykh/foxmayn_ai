/**
 * Source URLs compare exactly, except for a #fragment and trailing slashes:
 * "https://x.com/a/#b" and "https://x.com/a" are the same page.
 */
export const normalizeUrl = (url: string): string => {
	const hash = url.indexOf("#");
	const base = (hash === -1 ? url : url.slice(0, hash)).trim();
	return base.replace(/\/+$/, "");
};

/**
 * 1-based rank of the first retrieved source that is expected, or null.
 * Retrieval returns chunks, so a page can appear several times; its first
 * chunk counts.
 */
export const firstHitRank = (
	retrieved: (string | null)[],
	expected: string[],
): number | null => {
	const wanted = new Set(expected.map(normalizeUrl));
	const index = retrieved.findIndex((source) => source !== null && wanted.has(normalizeUrl(source)));
	return index === -1 ? null : index + 1;
};

export interface RetrievalScores {
	n: number;
	hit1: number;
	hit3: number;
	hitK: number;
	mrr: number;
}

/** hit@1, hit@3, hit@k (rates) and mean reciprocal rank over ranks. */
export const retrievalScores = (ranks: (number | null)[], k: number): RetrievalScores => {
	const n = ranks.length;
	if (n === 0) return { n: 0, hit1: 0, hit3: 0, hitK: 0, mrr: 0 };
	const rate = (limit: number) => ranks.filter((r) => r !== null && r <= limit).length / n;
	return {
		n,
		hit1: rate(1),
		hit3: rate(3),
		hitK: rate(k),
		mrr: ranks.reduce<number>((sum, r) => sum + (r !== null && r <= k ? 1 / r : 0), 0) / n,
	};
};
