/**
 * PDF page transcription with a vision model: constants, the billing math and
 * the page loop. Pure (the model call and the page renderer are passed in) so
 * it can be unit tested.
 */

import { calculateCost } from "./cost";
import { MAX_EXTRACTED_CHARS } from "./file_validation";

export const PAGE_TRANSCRIPTION_MODEL = "anthropic/claude-haiku-5.5";

export const PAGE_TRANSCRIPTION_PROMPT = `Transcribe this document page into Markdown.
- Keep every number, unit, model name, reference, phone number and email exactly as printed. Do not translate.
- Tables become Markdown tables, one row per printed row, each value in its own column.
- A diagram or photo becomes one line: [Figure: what it shows and its labels], in the page's language.
- Skip only the repeated page header and footer (logo, address band, page number).
- Output only the Markdown, no comment.`;

/** User-safe reasons recorded in document.metadata.transcriptionError. */
export const TRANSCRIPTION_FAILED_REASON =
	"Reading the PDF pages with vision failed. The text layer was indexed instead.";
export const TRANSCRIPTION_PROVIDER_REFUSED_REASON =
	"The AI provider rejected the page transcription request. The text layer was indexed instead.";
export const TRANSCRIPTION_UNPRICED_REASON =
	"The page transcription model has no price. The text layer was indexed instead.";
export const TRANSCRIPTION_UNREADABLE_REASON =
	"The PDF pages could not be rendered. The text layer was indexed instead.";

// Pages in flight at once
export const TRANSCRIPTION_CONCURRENCY = 4;

// Per-page estimate used for the credit reservation (measured: ~3700 in, ~800 out)
export const ESTIMATED_INPUT_TOKENS_PER_PAGE = 4000;
export const ESTIMATED_OUTPUT_TOKENS_PER_PAGE = 1500;

/** Tokens the provider charged for page transcriptions. */
export interface TranscriptionUsage {
	// Paid calls (a retry pays again for the pages it redoes)
	pages: number;
	inputTokens: number;
	outputTokens: number;
}

export const emptyUsage = (): TranscriptionUsage => ({
	pages: 0,
	inputTokens: 0,
	outputTokens: 0,
});

/** Credits to reserve before transcribing `pages` pages. Throws for an unpriced model. */
export const estimateTranscriptionCost = (pages: number): number =>
	calculateCost(
		PAGE_TRANSCRIPTION_MODEL,
		pages * ESTIMATED_INPUT_TOKENS_PER_PAGE,
		pages * ESTIMATED_OUTPUT_TOKENS_PER_PAGE,
	);

/**
 * Credits owed for the pages paid so far. Priced per page (average tokens per
 * call), because a price tier depends on the size of one prompt, not on the
 * sum over many calls. Zero when nothing was paid.
 */
export const transcriptionCost = (usage: TranscriptionUsage): number => {
	if (usage.pages <= 0) return 0;
	return (
		usage.pages *
		calculateCost(
			PAGE_TRANSCRIPTION_MODEL,
			usage.inputTokens / usage.pages,
			usage.outputTokens / usage.pages,
		)
	);
};

/**
 * Usage of one page call. Providers occasionally omit it: a page that was
 * answered always had an input, so bill the per-page estimate (and our own
 * count of the output) rather than nothing.
 */
export const resolvePageUsage = (
	usage: { inputTokens: number; outputTokens: number },
	outputTokenEstimate: number,
): { inputTokens: number; outputTokens: number } =>
	usage.inputTokens + usage.outputTokens > 0
		? usage
		: {
				inputTokens: ESTIMATED_INPUT_TOKENS_PER_PAGE,
				outputTokens: Math.max(1, outputTokenEstimate),
			};

/** Page texts in page order, joined by a blank line. Blank pages are dropped; the result is capped. */
export const joinTranscribedPages = (
	pages: string[],
	maxChars: number = MAX_EXTRACTED_CHARS,
): { text: string; truncated: boolean } => {
	const joined = pages
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.join("\n\n");
	return joined.length > maxChars
		? { text: joined.slice(0, maxChars), truncated: true }
		: { text: joined, truncated: false };
};

export interface PageCallResult {
	text: string;
	usage: { inputTokens: number; outputTokens: number };
}

/**
 * Render and transcribe every page. Pages are rendered one at a time (memory),
 * up to `concurrency` model calls run at once. `usage` is updated as each call
 * finishes, so on failure it still holds everything the provider charged: after
 * the first error no new page starts, running calls are awaited, then the
 * first error is thrown.
 */
export const transcribePages = async (options: {
	total: number;
	render: (page: number) => Promise<Uint8Array>;
	transcribe: (png: Uint8Array, page: number) => Promise<PageCallResult>;
	usage: TranscriptionUsage;
	concurrency?: number;
	onPageDone?: (done: number, total: number) => void | Promise<void>;
}): Promise<string[]> => {
	const {
		total,
		render,
		transcribe,
		usage,
		concurrency = TRANSCRIPTION_CONCURRENCY,
		onPageDone,
	} = options;

	const texts: string[] = Array.from({ length: total }, () => "");
	const running = new Set<Promise<void>>();
	const failures: unknown[] = [];
	let done = 0;

	for (let page = 1; page <= total && failures.length === 0; page++) {
		let png: Uint8Array;
		try {
			png = await render(page);
		} catch (error) {
			failures.push(error);
			break;
		}

		const task: Promise<void> = (async () => {
			try {
				const result = await transcribe(png, page);
				usage.pages += 1;
				usage.inputTokens += result.usage.inputTokens;
				usage.outputTokens += result.usage.outputTokens;
				texts[page - 1] = result.text;
				done += 1;
				await onPageDone?.(done, total);
			} catch (error) {
				failures.push(error);
			}
		})().finally(() => running.delete(task));
		running.add(task);

		if (running.size >= concurrency) await Promise.race(running);
	}

	await Promise.all(running);
	if (failures.length > 0) throw failures[0];
	return texts;
};
