export type PublicSource = { title: string; source: string | null };

/**
 * The sources an answer cites, one entry per document. `[n]` citations
 * (also `[1, 2]`) point into `sources` (1-based); citations of the same
 * document are grouped under its first appearance. Uncited and out-of-range
 * numbers are dropped, so an answer without citations lists no sources.
 */
export function citedSources(
	content: string,
	sources: readonly PublicSource[],
): { numbers: number[]; title: string; source: string | null }[] {
	const cited = new Set<number>();
	for (const match of content.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
		for (const n of match[1].split(",")) {
			const index = Number(n.trim());
			if (index >= 1 && index <= sources.length) cited.add(index);
		}
	}
	const groups = new Map<string, { numbers: number[]; title: string; source: string | null }>();
	for (const index of [...cited].sort((a, b) => a - b)) {
		const src = sources[index - 1];
		const key = src.source ?? `title:${src.title}`;
		const group = groups.get(key);
		if (group) group.numbers.push(index);
		else groups.set(key, { numbers: [index], title: src.title, source: src.source });
	}
	return [...groups.values()];
}
