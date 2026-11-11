import { titleLine } from "../services/chunking.service";

/**
 * The numbered passages the model answers from. Each passage starts with its
 * document title: a spec table or a page from the middle of a datasheet rarely
 * names the product, and the model must not attach it to the wrong one.
 */
export const formatContext = (
	sources: { title?: string | null; content: string }[],
): string =>
	sources
		.map((r, i) => {
			const title = titleLine(r.title);
			return title ? `[${i + 1}] ${title}\n${r.content}` : `[${i + 1}] ${r.content}`;
		})
		.join("\n\n");
