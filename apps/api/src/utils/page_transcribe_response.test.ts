import { test } from "node:test";
import assert from "node:assert/strict";
import {
	OpenRouterHttpError,
	TranscribePageError,
	parseChatCompletion,
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
