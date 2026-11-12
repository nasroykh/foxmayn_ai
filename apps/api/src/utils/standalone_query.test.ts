import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildRewriteInput,
	cleanRewrite,
	hasEarlierUserTurn,
	REWRITE_MAX_CHARS,
	REWRITE_MAX_HISTORY_MESSAGES,
	REWRITE_MAX_MESSAGE_CHARS,
	resolveRetrievalQuery,
} from "./standalone_query";

test("hasEarlierUserTurn needs a non-empty user turn", () => {
	assert.equal(hasEarlierUserTurn([]), false);
	assert.equal(hasEarlierUserTurn([{ role: "assistant", content: "hi" }]), false);
	assert.equal(hasEarlierUserTurn([{ role: "user", content: "  " }]), false);
	assert.equal(hasEarlierUserTurn([{ role: "user", content: "q" }]), true);
});

test("buildRewriteInput is a transcript followed by the last message", () => {
	const input = buildRewriteInput("  Et la\ngarantie ? ", [
		{ role: "user", content: "Parlez-moi de la X200" },
		{ role: "assistant", content: "La X200 est une perceuse." },
		{ role: "system", content: "ignored" },
		{ role: "user", content: "   " },
	]);
	assert.equal(
		input,
		[
			"Conversation:",
			"User: Parlez-moi de la X200",
			"Assistant: La X200 est une perceuse.",
			"",
			"Last user message: Et la garantie ?",
		].join("\n"),
	);
});

test("buildRewriteInput keeps the most recent messages, each cut", () => {
	const history = Array.from({ length: REWRITE_MAX_HISTORY_MESSAGES + 3 }, (_, i) => ({
		role: i % 2 ? "assistant" : "user",
		content: i === REWRITE_MAX_HISTORY_MESSAGES + 2 ? "x".repeat(5000) : `m${i}`,
	}));
	const lines = buildRewriteInput("q", history).split("\n");
	// "Conversation:", the messages, "", the last message
	assert.equal(lines.length, REWRITE_MAX_HISTORY_MESSAGES + 3);
	assert.ok(lines[1].endsWith("m3"));
	const last = lines[REWRITE_MAX_HISTORY_MESSAGES];
	assert.ok(last.length <= "Assistant: ".length + REWRITE_MAX_MESSAGE_CHARS + 1);
	assert.ok(last.endsWith("…"));
});

test("cleanRewrite keeps the first line, without a pair of wrapping quotes", () => {
	assert.equal(cleanRewrite('  "Garantie de   la X200 ?"  '), "Garantie de la X200 ?");
	assert.equal(cleanRewrite("« Garantie X200 »"), "Garantie X200");
	assert.equal(cleanRewrite("\nGarantie X200\nBecause the user asked about it."), "Garantie X200");
	// Quotes that do not wrap the whole line stay
	assert.equal(cleanRewrite("l'alarme de la X200"), "l'alarme de la X200");
	assert.equal(cleanRewrite("'s-Hertogenbosch delivery"), "'s-Hertogenbosch delivery");
	assert.equal(cleanRewrite('"X200" warranty'), '"X200" warranty');
});

test("buildRewriteInput never splits a surrogate pair at a cut", () => {
	const input = buildRewriteInput("q", [
		{ role: "user", content: "a".repeat(REWRITE_MAX_MESSAGE_CHARS - 1) + "😀 tail" },
	]);
	assert.doesNotMatch(input, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test("resolveRetrievalQuery skips the rewrite for a long message", async () => {
	let calls = 0;
	const long = "x".repeat(REWRITE_MAX_CHARS + 1);
	const result = await resolveRetrievalQuery(
		async () => {
			calls++;
			return "y";
		},
		long,
		[{ role: "user", content: "p" }],
	);
	assert.equal(calls, 0);
	assert.equal(result, `p\n${long}`);
});

test("cleanRewrite rejects empty and overlong output", () => {
	assert.equal(cleanRewrite(""), null);
	assert.equal(cleanRewrite("   "), null);
	assert.equal(cleanRewrite(null), null);
	assert.equal(cleanRewrite('""'), null);
	assert.equal(cleanRewrite("a".repeat(REWRITE_MAX_CHARS + 1)), null);
	assert.equal(cleanRewrite("a".repeat(REWRITE_MAX_CHARS)), "a".repeat(REWRITE_MAX_CHARS));
});

test("resolveRetrievalQuery does not call the model for a first message", async () => {
	let calls = 0;
	const rewrite = async () => {
		calls++;
		return "x";
	};
	assert.equal(await resolveRetrievalQuery(rewrite, "q", []), "q");
	assert.equal(
		await resolveRetrievalQuery(rewrite, "q", [{ role: "assistant", content: "hi" }]),
		"q",
	);
	assert.equal(calls, 0);
});

test("resolveRetrievalQuery uses the rewrite, given the transcript", async () => {
	const history = [{ role: "user", content: "La X200 fuit" }];
	let seen = "";
	const result = await resolveRetrievalQuery(
		async (input) => {
			seen = input;
			return '"Garantie de la X200"';
		},
		"Et la garantie ?",
		history,
	);
	assert.equal(result, "Garantie de la X200");
	assert.match(seen, /User: La X200 fuit\n\nLast user message: Et la garantie \?$/);
});

test("resolveRetrievalQuery falls back to the joined turns", async () => {
	const history = [{ role: "user", content: "La X200 fuit" }];
	const joined = "La X200 fuit\nEt la garantie ?";
	assert.equal(await resolveRetrievalQuery(async () => null, "Et la garantie ?", history), joined);
	assert.equal(await resolveRetrievalQuery(async () => "  ", "Et la garantie ?", history), joined);
	assert.equal(
		await resolveRetrievalQuery(async () => "a".repeat(REWRITE_MAX_CHARS + 1), "Et la garantie ?", history),
		joined,
	);
});

test("resolveRetrievalQuery lets a rewrite error through", async () => {
	await assert.rejects(
		resolveRetrievalQuery(
			async () => {
				throw new Error("no credits");
			},
			"q",
			[{ role: "user", content: "p" }],
		),
		/no credits/,
	);
});
