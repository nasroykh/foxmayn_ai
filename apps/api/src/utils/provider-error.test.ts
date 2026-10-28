import { test } from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/server";
import {
	isPermanentProviderError,
	requireAnswer,
	requireStreamedAnswer,
	toChatProviderError,
} from "./provider-error";

test("permanent provider statuses", () => {
	for (const s of [400, 401, 402, 403, 404]) {
		assert.equal(isPermanentProviderError({ statusCode: s }), true, String(s));
	}
	for (const s of [408, 429, 500, 502, 503]) {
		assert.equal(isPermanentProviderError({ statusCode: s }), false, String(s));
	}
	assert.equal(isPermanentProviderError(new Error("ECONNRESET")), false);
});

test("toChatProviderError maps provider failures without details", () => {
	const rejected = toChatProviderError({ statusCode: 401, message: "sk-or-secret" });
	assert.equal(rejected.code, "BAD_GATEWAY");
	assert.ok(!rejected.message.includes("secret"));
	for (const e of [{ statusCode: 429 }, { statusCode: 503 }, new Error("fetch failed")]) {
		assert.equal(toChatProviderError(e).code, "SERVICE_UNAVAILABLE");
	}
	const own = new ORPCError("BAD_REQUEST", { message: "x" });
	assert.equal(toChatProviderError(own), own);
});

const isNoAnswer = (err: unknown, finishReason?: string) => {
	assert.ok(err instanceof ORPCError);
	assert.equal(err.code, "BAD_GATEWAY");
	assert.equal(err.status, 502);
	assert.equal(err.message, "The model returned no answer");
	assert.deepEqual(err.data, finishReason ? { finishReason } : undefined);
	return true;
};

test("requireAnswer: empty or blank text is a 502 with the finish reason", () => {
	assert.equal(requireAnswer("Hello"), "Hello");
	assert.throws(() => requireAnswer(""), (e) => isNoAnswer(e));
	assert.throws(
		() => requireAnswer(" \n ", "max_output_tokens"),
		(e) => isNoAnswer(e, "max_output_tokens"),
	);
});

async function* chunks(...parts: string[]) {
	for (const p of parts) yield p;
}

const drain = async (stream: AsyncIterable<string>) => {
	const out: string[] = [];
	for await (const p of stream) out.push(p);
	return out;
};

test("requireStreamedAnswer passes text through", async () => {
	let accepted = 0;
	const out = await drain(
		requireStreamedAnswer(chunks("Hel", "", "lo"), () => accepted++),
	);
	assert.deepEqual(out, ["Hel", "lo"]);
	// Every chunk plus the end
	assert.equal(accepted, 4);
});

test("requireStreamedAnswer: a stream without text ends in a 502, after acceptance", async () => {
	for (const parts of [[], [""], ["", " ", "\n"]]) {
		let accepted = false;
		await assert.rejects(
			drain(requireStreamedAnswer(chunks(...parts), () => (accepted = true))),
			(e) => isNoAnswer(e),
		);
		// Accepted before the error, so the call is billed
		assert.equal(accepted, true);
	}
});
