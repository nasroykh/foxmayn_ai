import { test } from "node:test";
import assert from "node:assert/strict";
import {
	OpenRouterHttpError,
	TranscribePageError,
	parseChatCompletion,
	readTranscribeResponse,
} from "@repo/llm/openrouter";
import { errorStatus } from "../config/redact";
import { isPermanentProviderError } from "./provider-error";

test("parseChatCompletion reads text, usage and finish reason from the wire JSON", () => {
	const parsed = parseChatCompletion({
		choices: [
			{
				message: { role: "assistant", content: "| a | b |\n|---|---|" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 3700, completion_tokens: 800, cost: 0.0008 },
	});
	assert.deepEqual(parsed, {
		text: "| a | b |\n|---|---|",
		usage: { inputTokens: 3700, outputTokens: 800 },
		finishReason: "stop",
	});
});

test("parseChatCompletion marks an output cut off by the cap", () => {
	const parsed = parseChatCompletion({
		choices: [{ message: { content: "cut" }, finish_reason: "length" }],
		usage: { prompt_tokens: 3700, completion_tokens: 4000 },
	});
	assert.equal(parsed?.finishReason, "length");
});

test("parseChatCompletion joins text parts and tolerates missing fields", () => {
	assert.equal(
		parseChatCompletion({
			choices: [
				{
					message: {
						content: [
							{ type: "text", text: "one " },
							{ type: "image_url" },
							{ type: "text", text: "two" },
						],
					},
				},
			],
		})?.text,
		"one two",
	);
	// An answer without usage reads as 0 tokens: the caller bills its estimate
	assert.deepEqual(parseChatCompletion({ choices: [{ message: { content: "x" } }] })?.usage, {
		inputTokens: 0,
		outputTokens: 0,
	});
	// Empty answer, usage present: a blank page that was paid for
	assert.deepEqual(
		parseChatCompletion({
			choices: [{ message: { content: null } }],
			usage: { prompt_tokens: 3000, completion_tokens: 2 },
		}),
		{ text: "", usage: { inputTokens: 3000, outputTokens: 2 }, finishReason: undefined },
	);
});

test("parseChatCompletion refuses a body with neither answer nor usage", () => {
	assert.equal(parseChatCompletion(null), null);
	assert.equal(parseChatCompletion("oops"), null);
	assert.equal(parseChatCompletion({}), null);
	assert.equal(parseChatCompletion({ error: { message: "upstream failed" } }), null);
	// No choice but tokens were charged: still a paid call
	assert.deepEqual(parseChatCompletion({ usage: { prompt_tokens: 10, completion_tokens: 0 } })?.usage, {
		inputTokens: 10,
		outputTokens: 0,
	});
});

test("provider refusals keep their status; unreadable answers carry the usage to bill", () => {
	const refused = new OpenRouterHttpError(402, "no credit");
	assert.equal(errorStatus(refused), 402);
	assert.equal(isPermanentProviderError(refused), true);
	assert.equal(isPermanentProviderError(new OpenRouterHttpError(429, "")), false);
	assert.equal(isPermanentProviderError(new OpenRouterHttpError(503, "")), false);

	const unreadable = new TranscribePageError(
		"unreadable",
		{ inputTokens: 4000, outputTokens: 1500 },
		{ cause: new Error("bad json") },
	);
	assert.deepEqual(unreadable.paidUsage, { inputTokens: 4000, outputTokens: 1500 });
	// A retry can succeed, so it is not a permanent provider error
	assert.equal(isPermanentProviderError(unreadable), false);
});

const estimate = { inputTokens: 4000, outputTokens: 1500 };

test("a 2xx body with an error object throws the status from its code, permanent for 401-403", () => {
	for (const code of [401, 402, 403, "402"]) {
		let err: unknown;
		try {
			readTranscribeResponse({ error: { code, message: "no credit" } }, estimate);
		} catch (e) {
			err = e;
		}
		assert.ok(err instanceof OpenRouterHttpError, String(code));
		assert.equal(err.statusCode, Number(code));
		assert.equal(isPermanentProviderError(err), true);
		// No usage in the body: nothing to bill
		assert.equal(err.paidUsage, undefined);
	}
});

test("an error body without a usable code is a retryable gateway error", () => {
	for (const error of [{ message: "upstream" }, { code: "weird" }, { code: 200 }, { code: 503 }]) {
		try {
			readTranscribeResponse({ error }, estimate);
			assert.fail("should throw");
		} catch (e) {
			assert.ok(e instanceof OpenRouterHttpError);
			assert.equal(isPermanentProviderError(e), false);
		}
	}
});

test("an error body carries paidUsage only when it reports usage", () => {
	try {
		readTranscribeResponse(
			{ error: { code: 502, message: "cut" }, usage: { prompt_tokens: 3000, completion_tokens: 10 } },
			estimate,
		);
		assert.fail("should throw");
	} catch (e) {
		assert.ok(e instanceof OpenRouterHttpError);
		assert.deepEqual(e.paidUsage, { inputTokens: 3000, outputTokens: 10 });
	}
});

test("finish_reason error is a failure carrying the body usage, else the estimate", () => {
	for (const [usage, paid] of [
		[{ prompt_tokens: 3500, completion_tokens: 0 }, { inputTokens: 3500, outputTokens: 0 }],
		[undefined, estimate],
	] as const) {
		try {
			readTranscribeResponse(
				{ choices: [{ message: { content: "" }, finish_reason: "error" }], usage },
				estimate,
			);
			assert.fail("should throw");
		} catch (e) {
			assert.ok(e instanceof TranscribePageError);
			assert.deepEqual(e.paidUsage, paid);
		}
	}
});

test("a body with nothing readable carries the estimate; a good body passes through", () => {
	try {
		readTranscribeResponse({}, estimate);
		assert.fail("should throw");
	} catch (e) {
		assert.ok(e instanceof TranscribePageError);
		assert.deepEqual(e.paidUsage, estimate);
	}
	const ok = readTranscribeResponse(
		{
			choices: [{ message: { content: "page" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3700, completion_tokens: 800 },
		},
		estimate,
	);
	assert.equal(ok.text, "page");
	assert.deepEqual(ok.usage, { inputTokens: 3700, outputTokens: 800 });
});
