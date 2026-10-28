import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCases } from "./cases";
import { createFoxmaynClient } from "./client";
import { postJson, HttpError } from "./http";
import { judgeAnswer } from "./judge";
import { compareRuns, formatFailures, formatSummary, type ResultsFile } from "./report";
import { outOfScopePassed, runEval, summarize, type CaseResult } from "./run";
import { json, mockFetch, noWait } from "./test-helpers";

const KEY = "fx-chat-only-secret";

const CASES = parseCases(
	[
		{ id: "price-en", lang: "en", question: "How much is Pro?", expected: ["https://x.com/en/pricing"] },
		{ id: "price-ar", lang: "ar", question: "كم سعر برو؟", expected: ["https://x.com/ar/pricing/"] },
		{ id: "ship-en", lang: "en", question: "Do you ship?", expected: ["https://x.com/en/shipping"] },
		{ id: "weather", lang: "en", question: "Weather tomorrow?", outOfScope: true },
		{ id: "order", lang: "en", question: "Where is order 7?", expected: ["https://x.com/en/orders"] },
	]
		.map((c) => JSON.stringify(c))
		.join("\n"),
);

const passage = (source: string) => ({ source, title: "", content: `About ${source}`, score: 0.7 });

// The deployed API and the judge, by question
const SEARCH: Record<string, string[]> = {
	"How much is Pro?": ["https://x.com/en/pricing#pro", "https://x.com/en/faq"],
	"كم سعر برو؟": ["https://x.com/ar/faq", "https://x.com/en/faq", "https://x.com/ar/pricing"],
	"Do you ship?": ["https://x.com/en/faq"],
	"Where is order 7?": ["https://x.com/en/orders"],
};
const ANSWERS: Record<string, unknown> = {
	"How much is Pro?": {
		answer: "Pro costs 7,900 DZD [1].",
		sources: [passage("https://x.com/en/pricing")],
		usage: { inputTokens: 500, outputTokens: 20 },
		finishReason: "stop",
	},
	"كم سعر برو؟": {
		answer: "7900 دج [1].",
		sources: [passage("https://x.com/ar/pricing")],
		finishReason: "stop",
	},
	"Do you ship?": { answer: "Yes, everywhere [1].", sources: [passage("https://x.com/en/faq")], finishReason: "stop" },
	"Weather tomorrow?": { answer: "I can only help with our store.", sources: [], finishReason: "stop" },
	"Where is order 7?": {
		answer: "",
		sources: [],
		finishReason: "tool_calls",
		toolCalls: [{ id: "c1", name: "lookup_order", arguments: { orderId: "7" } }],
		continuationId: "x",
	},
};
const VERDICTS: Record<string, unknown> = {
	"Pro costs 7,900 DZD [1].": { supported: "yes", citationsCorrect: true, answered: true, notes: "ok" },
	"7900 دج [1].": { supported: "yes", citationsCorrect: true, answered: true, notes: "ok" },
	"Yes, everywhere [1].": {
		supported: "no",
		citationsCorrect: false,
		answered: true,
		notes: "the passage does not mention shipping",
	},
	"I can only help with our store.": { supported: "yes", citationsCorrect: true, answered: false, notes: "declines" },
};

const deployed = () =>
	mockFetch((url, body) => {
		if (url === "https://ai.example.com/api/v1/chat/search") {
			return json({ results: (SEARCH[String(body.query)] ?? []).map(passage) });
		}
		if (url === "https://ai.example.com/api/v1/chat/query") return json(ANSWERS[String(body.query)]);
		if (url === "https://openrouter.ai/api/v1/chat/completions") {
			const user = (body.messages as { content: string }[])[1].content;
			const answer = Object.keys(VERDICTS).find((a) => user.includes(a))!;
			return json({ choices: [{ message: { content: JSON.stringify(VERDICTS[answer]) } }] });
		}
		return json({ message: "not found" }, 404);
	});

const run = async (answers: boolean) => {
	const { fetch, calls } = deployed();
	const client = createFoxmaynClient({ baseUrl: "https://ai.example.com/", apiKey: KEY, fetch, retry: noWait });
	const results = await runEval(CASES, {
		client,
		k: 2,
		concurrency: 2,
		judge: answers
			? (input) => judgeAnswer({ fetch, apiKey: "or-key", model: "m", retry: noWait, ...input })
			: undefined,
	});
	return { results, calls };
};

const byId = (results: CaseResult[], id: string) => results.find((r) => r.id === id)!;

test("retrieval only: ranks, misses, no chat or judge calls, out-of-scope skipped", async () => {
	const { results, calls } = await run(false);
	assert.deepEqual(
		results.map((r) => r.id),
		CASES.map((c) => c.id),
	);
	assert.equal(byId(results, "price-en").retrieval?.rank, 1);
	// Rank 3 is past k = 2: a miss
	assert.equal(byId(results, "price-ar").retrieval?.rank, 3);
	assert.match(byId(results, "price-ar").failures[0], /no expected source in top 2/);
	assert.equal(byId(results, "ship-en").retrieval?.rank, null);
	assert.equal(byId(results, "weather").retrieval, undefined);
	assert.equal(calls.every((c) => c.url.endsWith("/chat/search")), true);
	assert.equal(calls.length, 4);

	// The key goes in the header, never in a body
	const headers = calls[0].init.headers as Record<string, string>;
	assert.equal(headers["x-api-key"], KEY);
	assert.equal(calls.some((c) => String(c.init.body).includes(KEY)), false);
	const body = JSON.parse(String(calls[0].init.body)) as { options: { limit: number } };
	assert.equal(body.options.limit, 2);

	const [ar, en, all] = summarize(results, 2);
	assert.deepEqual([ar.lang, en.lang, all.lang], ["ar", "en", "all"]);
	assert.equal(en.retrieval.n, 3);
	assert.equal(en.retrieval.hitK, 2 / 3);
	assert.equal(all.retrieval.mrr, (1 + 0 + 0 + 1) / 4);
});

test("answers: judged, tool outcome recorded and not judged, out-of-scope pass", async () => {
	const { results, calls } = await run(true);

	const tool = byId(results, "order");
	assert.deepEqual(tool.answer, { outcome: "tool", tools: ["lookup_order"] });
	assert.equal(tool.judge, undefined);
	assert.deepEqual(tool.failures, []);

	const weather = byId(results, "weather");
	assert.ok(weather.judge && outOfScopePassed(weather.judge));
	assert.deepEqual(weather.failures, []);

	const ship = byId(results, "ship-en");
	assert.deepEqual(ship.failures.slice(1), [
		"supported: no (the passage does not mention shipping)",
		"citations wrong (the passage does not mention shipping)",
	]);

	// Chat queries are client-managed: no conversation is stored
	const query = calls.find((c) => c.url.endsWith("/chat/query"))!;
	assert.deepEqual((JSON.parse(String(query.init.body)) as { messages: unknown[] }).messages, []);
	// One judge call per judged answer (the tool turn is not judged)
	assert.equal(calls.filter((c) => c.url.includes("openrouter")).length, 4);

	const all = summarize(results, 2).at(-1)!;
	assert.deepEqual(all.supportedYes, { num: 2, den: 3 });
	assert.deepEqual(all.citationsCorrect, { num: 2, den: 3 });
	assert.deepEqual(all.outOfScopePass, { num: 1, den: 1 });
	assert.equal(all.tools, 1);

	const failures = formatFailures(results);
	assert.match(failures, /order \[en\]: tool outcome \(lookup_order\), not judged/);
	assert.match(failures, /ship-en \[en\]: supported: no/);
	const table = formatSummary(summarize(results, 2), 2, true);
	assert.match(table, /^lang\s+n\s+hit@1\s+hit@3\s+hit@2\s+MRR\s+supported/);
	assert.equal(table.includes(KEY), false);
});

test("out-of-scope fails when the model answers anyway", () => {
	assert.equal(
		outOfScopePassed({
			ok: true,
			verdict: { supported: "no", citationsCorrect: true, answered: true, notes: "" },
		}),
		false,
	);
	assert.equal(outOfScopePassed({ ok: false, error: "judge_error", detail: "x" }), false);
});

test("a bad judge output is counted as judge_error, not dropped", async () => {
	const { fetch } = mockFetch((url) =>
		url.includes("openrouter")
			? json({ choices: [{ message: { content: "Looks good to me" } }] })
			: url.endsWith("/chat/query")
				? json(ANSWERS["How much is Pro?"])
				: json({ results: [passage("https://x.com/en/pricing")] }),
	);
	const client = createFoxmaynClient({ baseUrl: "https://ai.example.com", apiKey: KEY, fetch, retry: noWait });
	const results = await runEval(CASES.slice(0, 1), {
		client,
		k: 6,
		concurrency: 1,
		judge: (input) => judgeAnswer({ fetch, apiKey: "k", model: "m", retry: noWait, ...input }),
	});
	assert.match(results[0].failures[0], /^judge_error: /);
	assert.equal(summarize(results, 6).at(-1)!.judgeErrors, 1);
});

test("429 and 5xx are retried with backoff (Retry-After honoured), at most 3 times", async () => {
	noWait.delays.length = 0;
	let attempts = 0;
	const flaky = mockFetch(() => {
		attempts++;
		if (attempts === 1) return json({ message: "slow down" }, 429, { "retry-after": "2" });
		if (attempts === 2) return json({ message: "oops" }, 502);
		return json({ ok: true });
	});
	assert.deepEqual(await postJson(flaky.fetch, "u", {}, {}, noWait), { ok: true });
	assert.deepEqual(noWait.delays, [2000, 2000]);

	attempts = 0;
	const down = mockFetch(() => {
		attempts++;
		return json({ message: "down" }, 503);
	});
	await assert.rejects(postJson(down.fetch, "u", { "x-api-key": KEY }, {}, noWait), (err: unknown) => {
		assert.ok(err instanceof HttpError);
		assert.equal(err.status, 503);
		assert.equal(err.message.includes(KEY), false);
		return true;
	});
	assert.equal(attempts, 4);

	attempts = 0;
	const forbidden = mockFetch(() => {
		attempts++;
		return json({ message: "Insufficient credits" }, 403);
	});
	await assert.rejects(postJson(forbidden.fetch, "u", {}, {}, noWait), /HTTP 403: Insufficient credits/);
	assert.equal(attempts, 1);
});

test("a failed search or chat call is a failure line, and the run goes on", async () => {
	const { fetch } = mockFetch((url) =>
		url.endsWith("/chat/search") ? json({ message: "Insufficient credits" }, 403) : json({}),
	);
	const client = createFoxmaynClient({ baseUrl: "https://ai.example.com", apiKey: KEY, fetch, retry: noWait });
	const results = await runEval(CASES, { client, k: 6, concurrency: 3 });
	assert.equal(results.length, CASES.length);
	assert.match(byId(results, "price-en").failures[0], /search failed: HTTP 403: Insufficient credits/);
});

// ============================================================================
// --compare
// ============================================================================

const resultsFile = (cases: CaseResult[], k = 2): ResultsFile => ({
	version: 1,
	createdAt: "2026-10-28T00:00:00.000Z",
	k,
	answers: false,
	judgeModel: null,
	summary: summarize(cases, k),
	cases,
});

test("--compare prints metric deltas per language and cases that flipped", async () => {
	const { results: before } = await run(false);
	const after = structuredClone(before);
	// price-ar now ranks first; price-en drops out of the top k
	Object.assign(byId(after, "price-ar"), { retrieval: { rank: 1, sources: [] }, failures: [] });
	Object.assign(byId(after, "price-en"), {
		retrieval: { rank: null, sources: [] },
		failures: ["retrieval: no expected source in top 2 (top: nothing)"],
	});

	const report = compareRuns(resultsFile(before), resultsFile(after));
	const lines = report.split("\n");
	const row = (lang: string) => lines.find((l) => l.startsWith(`${lang} `))!.split(/\s{2,}/);
	// lang, hit@1, hit@3, hit@k, MRR, ...
	// ar: rank 3 (past k = 2, so MRR 0) becomes rank 1; hit@3 already counted it
	assert.deepEqual(row("ar").slice(0, 5), ["ar", "+100pt", "0pt", "+100pt", "+1.00"]);
	// en: ranks [1, miss, 1] become [miss, miss, 1]
	assert.deepEqual(row("en").slice(0, 5), ["en", "-33pt", "-33pt", "-33pt", "-0.33"]);
	// all: ranks [1, 3, miss, 1] become [miss, 1, miss, 1]
	assert.deepEqual(row("all").slice(0, 5), ["all", "0pt", "-25pt", "0pt", "0.00"]);
	assert.match(report, /Now failing \(1\):\nprice-en \[en\]: retrieval: no expected source/);
	assert.match(report, /Now passing \(1\):\nprice-ar \[ar\]/);
});

test("--compare warns when k changed and lists added and removed cases", async () => {
	const { results } = await run(false);
	const report = compareRuns(resultsFile(results, 2), resultsFile(results.slice(1), 6));
	assert.match(report, /k changed from 2 to 6/);
	assert.match(report, /Cases added: 0, removed: 1/);
});
