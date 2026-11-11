import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCost, computeSettlement } from "./cost";
import {
	ESTIMATED_INPUT_TOKENS_PER_PAGE,
	ESTIMATED_OUTPUT_TOKENS_PER_PAGE,
	PAGE_TRANSCRIPTION_MODEL,
	PAGE_TRANSCRIPTION_PROMPT,
	emptyUsage,
	estimateTranscriptionCost,
	joinTranscribedPages,
	MAX_PAGE_IMAGE_HEIGHT,
	PAGE_IMAGE_WIDTH,
	PageNotRenderableError,
	planPageImageWidth,
	resolvePageUsage,
	transcribePages,
	transcriptionCost,
	type PageCallResult,
} from "./transcription";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;

test("the model is priced, so an estimate can be reserved", () => {
	assert.equal(PAGE_TRANSCRIPTION_MODEL, "anthropic/claude-haiku-5.5");
	assert.ok(estimateTranscriptionCost(1) > 0);
});

test("the estimate covers every page at 4000 in and 1500 out tokens", () => {
	const pages = 12;
	assert.ok(
		close(
			estimateTranscriptionCost(pages),
			calculateCost(
				PAGE_TRANSCRIPTION_MODEL,
				pages * ESTIMATED_INPUT_TOKENS_PER_PAGE,
				pages * ESTIMATED_OUTPUT_TOKENS_PER_PAGE,
			),
		),
	);
	assert.equal(ESTIMATED_INPUT_TOKENS_PER_PAGE, 4000);
	assert.equal(ESTIMATED_OUTPUT_TOKENS_PER_PAGE, 1500);
	// Grows with the page count
	assert.ok(estimateTranscriptionCost(20) > estimateTranscriptionCost(10));
});

test("settling charges the tokens actually used, not the estimate", () => {
	const pages = 10;
	const reserved = estimateTranscriptionCost(pages);
	// Measured sizes: ~3700 in, ~800 out per page, below the estimate
	const actual = transcriptionCost({
		pages,
		inputTokens: pages * 3700,
		outputTokens: pages * 800,
	});
	assert.ok(
		close(actual, pages * calculateCost(PAGE_TRANSCRIPTION_MODEL, 3700, 800)),
	);
	assert.ok(actual < reserved);

	const settlement = computeSettlement(reserved, actual);
	assert.equal(settlement.kind, "refund");
	assert.ok(close(settlement.amount, reserved - actual));
});

test("pages that cost more than the estimate are collected as a shortfall", () => {
	const reserved = estimateTranscriptionCost(2);
	const actual = transcriptionCost({
		pages: 2,
		inputTokens: 2 * 6000,
		outputTokens: 2 * 4000,
	});
	const settlement = computeSettlement(reserved, actual);
	assert.equal(settlement.kind, "charge");
	assert.ok(close(settlement.amount, actual - reserved));
});

test("nothing paid costs nothing, a failed run keeps what was paid for", () => {
	assert.equal(transcriptionCost(emptyUsage()), 0);
	// 3 pages paid before the failure: only those are charged
	const paid = { pages: 3, inputTokens: 11_100, outputTokens: 2_400 };
	assert.ok(close(transcriptionCost(paid), 3 * calculateCost(PAGE_TRANSCRIPTION_MODEL, 3700, 800)));
});

test("a retry's pages add to the pages paid before", () => {
	// Earlier attempts paid 4 pages, this attempt 2 more
	const total = {
		pages: 4 + 2,
		inputTokens: 4 * 3700 + 2 * 3700,
		outputTokens: 4 * 800 + 2 * 800,
	};
	assert.ok(close(transcriptionCost(total), 6 * calculateCost(PAGE_TRANSCRIPTION_MODEL, 3700, 800)));
});

test("a missing usage report is billed at the per-page estimate", () => {
	assert.deepEqual(resolvePageUsage({ inputTokens: 3700, outputTokens: 800 }, 5), {
		inputTokens: 3700,
		outputTokens: 800,
	});
	assert.deepEqual(resolvePageUsage({ inputTokens: 0, outputTokens: 0 }, 300), {
		inputTokens: ESTIMATED_INPUT_TOKENS_PER_PAGE,
		outputTokens: 300,
	});
	assert.deepEqual(resolvePageUsage({ inputTokens: 0, outputTokens: 0 }, 0), {
		inputTokens: ESTIMATED_INPUT_TOKENS_PER_PAGE,
		outputTokens: 1,
	});
});

test("pages are joined in order with a blank line", () => {
	const { text, truncated } = joinTranscribedPages(["# One\n", "  two  ", "three"]);
	assert.equal(text, "# One\n\ntwo\n\nthree");
	assert.equal(truncated, false);
});

test("blank pages are dropped from the join", () => {
	assert.equal(joinTranscribedPages(["a", "", "  \n", "b"]).text, "a\n\nb");
	assert.equal(joinTranscribedPages(["", " "]).text, "");
	assert.equal(joinTranscribedPages([]).text, "");
});

test("the joined text is capped", () => {
	const capped = joinTranscribedPages(["aaaa", "bbbb", "cccc"], 10);
	assert.equal(capped.text.length, 10);
	assert.equal(capped.text, "aaaa\n\nbbbb".slice(0, 10));
	assert.equal(capped.truncated, true);
	// Exactly at the cap is not truncated
	const exact = joinTranscribedPages(["aaaa", "bbbb"], 10);
	assert.equal(exact.text, "aaaa\n\nbbbb");
	assert.equal(exact.truncated, false);
});

test("the prompt asks for Markdown only and keeps values exact", () => {
	assert.match(PAGE_TRANSCRIPTION_PROMPT, /^Transcribe this document page into Markdown\./);
	assert.match(PAGE_TRANSCRIPTION_PROMPT, /Do not translate/);
	assert.match(PAGE_TRANSCRIPTION_PROMPT, /\[Figure:/);
	assert.match(PAGE_TRANSCRIPTION_PROMPT, /Output only the Markdown, no comment\.$/);
});

// ============================================================================
// Page loop
// ============================================================================

const png = (page: number) => new Uint8Array([page]);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("transcribePages returns the texts in page order and sums the usage", async () => {
	const usage = emptyUsage();
	const rendered: number[] = [];
	const { texts } = await transcribePages({
		total: 6,
		usage,
		render: async (page) => {
			rendered.push(page);
			return png(page);
		},
		// Later pages finish first: the order must still follow the pages
		transcribe: async (image, page) => {
			await delay((7 - page) * 3);
			return { text: `page ${image[0]}`, usage: { inputTokens: 100, outputTokens: 10 } };
		},
	});

	assert.deepEqual(texts, ["page 1", "page 2", "page 3", "page 4", "page 5", "page 6"]);
	// Rendered one after the other, in order
	assert.deepEqual(rendered, [1, 2, 3, 4, 5, 6]);
	assert.deepEqual(usage, { pages: 6, inputTokens: 600, outputTokens: 60 });
});

test("transcribePages never runs more than four calls at once", async () => {
	let running = 0;
	let peak = 0;
	await transcribePages({
		total: 12,
		usage: emptyUsage(),
		render: async (page) => png(page),
		transcribe: async () => {
			running++;
			peak = Math.max(peak, running);
			await delay(5);
			running--;
			return { text: "x", usage: { inputTokens: 1, outputTokens: 1 } };
		},
	});
	assert.equal(peak, 4);
});

test("transcribePages reports progress per finished page", async () => {
	const seen: string[] = [];
	await transcribePages({
		total: 3,
		usage: emptyUsage(),
		render: async (page) => png(page),
		transcribe: async () => ({ text: "x", usage: { inputTokens: 1, outputTokens: 1 } }),
		onPageDone: (done, total) => {
			seen.push(`${done}/${total}`);
		},
	});
	assert.deepEqual(seen, ["1/3", "2/3", "3/3"]);
});

test("a failing page stops new pages, waits for running calls and keeps their usage", async () => {
	const usage = emptyUsage();
	const started: number[] = [];
	const call = async (image: Uint8Array, page: number): Promise<PageCallResult> => {
		started.push(page);
		if (page === 2) {
			await delay(2);
			throw new Error("provider down");
		}
		await delay(15);
		return { text: `p${image[0]}`, usage: { inputTokens: 100, outputTokens: 10 } };
	};

	await assert.rejects(
		transcribePages({
			total: 20,
			usage,
			render: async (page) => png(page),
			transcribe: call,
		}),
		{ message: "provider down" },
	);

	// Far from every page was started, and nothing is still running
	assert.ok(started.length < 20, `started ${started.length}`);
	// The calls that finished before and during the failure were paid for and counted
	assert.ok(usage.pages >= 1);
	assert.equal(usage.inputTokens, usage.pages * 100);
	assert.equal(usage.outputTokens, usage.pages * 10);
	const frozen = { ...usage };
	await delay(40);
	assert.deepEqual(usage, frozen);
});

test("a page that cannot be rendered fails the run without calling the model for it", async () => {
	const usage = emptyUsage();
	const called: number[] = [];
	await assert.rejects(
		transcribePages({
			total: 5,
			usage,
			render: async (page) => {
				if (page === 3) throw new Error("render failed");
				return png(page);
			},
			transcribe: async (_image, page) => {
				called.push(page);
				return { text: "x", usage: { inputTokens: 1, outputTokens: 1 } };
			},
		}),
		{ message: "render failed" },
	);
	assert.ok(!called.includes(3));
	assert.ok(!called.includes(4));
});

test("a failed call that carries paidUsage is still counted", async () => {
	const usage = emptyUsage();
	await assert.rejects(
		transcribePages({
			total: 3,
			usage,
			render: async (page) => png(page),
			transcribe: async (_image, page) => {
				if (page === 2) {
					// The provider answered but the body could not be read: billed anyway
					throw Object.assign(new Error("unreadable"), {
						paidUsage: { inputTokens: 4000, outputTokens: 1500 },
					});
				}
				await delay(10);
				return { text: "x", usage: { inputTokens: 100, outputTokens: 10 } };
			},
		}),
		{ message: "unreadable" },
	);
	// Page 2 at the estimate, plus the calls that finished while it failed
	assert.ok(usage.pages >= 1);
	assert.ok(usage.inputTokens >= 4000);
	assert.ok(usage.outputTokens >= 1500);
});

test("transcribePages lists the pages cut off by the output cap, in page order", async () => {
	const { truncatedPages } = await transcribePages({
		total: 6,
		usage: emptyUsage(),
		render: async (page) => png(page),
		transcribe: async (_image, page) => {
			await delay((7 - page) * 2);
			return {
				text: "x",
				usage: { inputTokens: 1, outputTokens: 1 },
				truncated: page === 5 || page === 2,
			};
		},
	});
	assert.deepEqual(truncatedPages, [2, 5]);
});

test("blank pages do not fail a document that has text elsewhere", () => {
	assert.equal(joinTranscribedPages(["", "text", ""]).text, "text");
});

// ============================================================================
// Page image budget
// ============================================================================

test("a normal page is rendered 1400 px wide", () => {
	assert.equal(planPageImageWidth(612, 792), PAGE_IMAGE_WIDTH); // US letter
	assert.equal(planPageImageWidth(595, 842), PAGE_IMAGE_WIDTH); // A4
	assert.equal(planPageImageWidth(842, 595), PAGE_IMAGE_WIDTH); // A4 landscape
	assert.equal(planPageImageWidth(10, 10), PAGE_IMAGE_WIDTH); // tiny pages scale up
});

test("a very tall page is scaled down to at most 4000 px high", () => {
	// 1:3 page would be 4200 px at 1400 wide
	const width = planPageImageWidth(100, 300);
	assert.ok(width < PAGE_IMAGE_WIDTH);
	assert.ok((300 * width) / 100 <= MAX_PAGE_IMAGE_HEIGHT);
	// Never more than the pixel budget, whatever the shape
	for (const [w, h] of [[100, 300], [50, 1000], [612, 10000], [1, 20]]) {
		const imageWidth = planPageImageWidth(w, h);
		assert.ok(imageWidth <= PAGE_IMAGE_WIDTH);
		assert.ok(imageWidth * ((h * imageWidth) / w) <= PAGE_IMAGE_WIDTH * MAX_PAGE_IMAGE_HEIGHT);
	}
});

test("absurd or unusable page sizes are refused before any canvas is made", () => {
	// MediaBox [0 0 1 100000]
	assert.throws(() => planPageImageWidth(1, 100_000), PageNotRenderableError);
	assert.throws(() => planPageImageWidth(100_000, 1), PageNotRenderableError);
	assert.throws(() => planPageImageWidth(0, 100), PageNotRenderableError);
	assert.throws(() => planPageImageWidth(100, 0), PageNotRenderableError);
	assert.throws(() => planPageImageWidth(-5, 100), PageNotRenderableError);
	assert.throws(() => planPageImageWidth(Number.NaN, 100), PageNotRenderableError);
	assert.throws(() => planPageImageWidth(100, Number.POSITIVE_INFINITY), PageNotRenderableError);
});
