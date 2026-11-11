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
export const TRANSCRIPTION_EMPTY_REASON =
	"The model found no text on any page. The text layer was indexed instead.";
export const TRANSCRIPTION_UNREADABLE_REASON =
	"The PDF pages could not be rendered. The text layer was indexed instead.";

// Page image size budget. A page is rendered 1400 px wide; one that would
// come out taller than 4000 px is scaled down to fit (at most 1400 x 4000 =
// 5.6 million pixels). Page boxes are attacker controlled: a 1 x 100000 pt page
// would otherwise ask for a canvas that aborts the process.
export const PAGE_IMAGE_WIDTH = 1400;
export const MAX_PAGE_IMAGE_HEIGHT = 4000;
// Below this a page is too thin to read: refuse instead of rendering a sliver
export const MIN_PAGE_IMAGE_WIDTH = 200;
export const MIN_PAGE_IMAGE_HEIGHT = 50;
// A page box outside these sizes (in points) is not a real page: pdf.js accepts
// exponent numbers in a MediaBox, and scaling those loses all precision
export const MIN_PAGE_BOX_POINTS = 1;
export const MAX_PAGE_BOX_POINTS = 1_000_000;

/** A page whose size cannot be rendered into a readable, bounded image. */
export class PageNotRenderableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PageNotRenderableError";
	}
}

/**
 * Pixel width to render a page of `width` x `height` points at: 1400, or less
 * when the page is so tall that the image would pass 4000 px. Throws
 * PageNotRenderableError for sizes that are not usable (zero, negative, not
 * finite, absurdly large or small, or an aspect ratio so extreme the image
 * would be a sliver). Computed with ratios, so no product can overflow.
 */
export const planPageImageWidth = (width: number, height: number): number => {
	const inBounds = (n: number) =>
		Number.isFinite(n) && n >= MIN_PAGE_BOX_POINTS && n <= MAX_PAGE_BOX_POINTS;
	if (!inBounds(width) || !inBounds(height))
		throw new PageNotRenderableError("Page has no usable size");

	let imageWidth: number = PAGE_IMAGE_WIDTH;
	let imageHeight = imageWidth * (height / width);
	if (!(imageHeight <= MAX_PAGE_IMAGE_HEIGHT)) {
		imageHeight = MAX_PAGE_IMAGE_HEIGHT;
		imageWidth = Math.floor(MAX_PAGE_IMAGE_HEIGHT * (width / height));
	}
	if (
		!Number.isFinite(imageWidth) ||
		!Number.isFinite(imageHeight) ||
		imageWidth < MIN_PAGE_IMAGE_WIDTH ||
		imageWidth > PAGE_IMAGE_WIDTH ||
		imageHeight < MIN_PAGE_IMAGE_HEIGHT ||
		imageHeight > MAX_PAGE_IMAGE_HEIGHT
	)
		throw new PageNotRenderableError("Page shape is too extreme to render");
	return imageWidth;
};

// Pages in flight at once
export const TRANSCRIPTION_CONCURRENCY = 4;
// Paid pages are saved to the job data this often (a crash loses at most that many)
export const TRANSCRIPTION_SAVE_EVERY_PAGES = 4;

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
	// The model hit its output cap: the page text is cut off
	truncated?: boolean;
}

/** Usage a failed call was still charged for, when the error carries it (`paidUsage`). */
const paidUsageOf = (
	error: unknown,
): { inputTokens: number; outputTokens: number } | undefined => {
	const paid = (error as { paidUsage?: unknown } | null)?.paidUsage as
		| { inputTokens?: unknown; outputTokens?: unknown }
		| undefined;
	return paid &&
		typeof paid.inputTokens === "number" &&
		typeof paid.outputTokens === "number"
		? { inputTokens: paid.inputTokens, outputTokens: paid.outputTokens }
		: undefined;
};

/**
 * Render and transcribe every page. Pages are rendered one at a time (memory),
 * up to `concurrency` model calls run at once. `usage` is updated as each call
 * finishes, so on failure it still holds everything the provider charged: after
 * the first error no new page starts, running calls are awaited, then the
 * first error is thrown. A failed call whose error carries `paidUsage` (the
 * provider answered, so it is billed) is counted too.
 * Also returns the pages whose answer was cut off by the output cap.
 */
export const transcribePages = async (options: {
	total: number;
	render: (page: number) => Promise<Uint8Array>;
	transcribe: (png: Uint8Array, page: number) => Promise<PageCallResult>;
	usage: TranscriptionUsage;
	concurrency?: number;
	onPageDone?: (done: number, total: number) => void | Promise<void>;
}): Promise<{ texts: string[]; truncatedPages: number[] }> => {
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
	const truncatedPages: number[] = [];
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
				if (result.truncated) truncatedPages.push(page);
				done += 1;
				await onPageDone?.(done, total);
			} catch (error) {
				const paid = paidUsageOf(error);
				if (paid) {
					usage.pages += 1;
					usage.inputTokens += paid.inputTokens;
					usage.outputTokens += paid.outputTokens;
				}
				failures.push(error);
			}
		})().finally(() => running.delete(task));
		running.add(task);

		if (running.size >= concurrency) await Promise.race(running);
	}

	await Promise.all(running);
	if (failures.length > 0) throw failures[0];
	return { texts, truncatedPages: truncatedPages.sort((a, b) => a - b) };
};
