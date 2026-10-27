import { test } from "node:test";
import assert from "node:assert/strict";
import {
	calculateCost,
	estimateChatCost,
	resolveChatCost,
	computeSettlement,
	isKnownChatModel,
	isKnownEmbeddingModel,
	CREDIT_EPSILON,
} from "./cost";

const MODEL = "google/gemini-2.5-flash-lite"; // $0.1 in, $0.4 out per 1M

test("calculateCost uses per-million prices", () => {
	assert.ok(Math.abs(calculateCost(MODEL, 1_000_000, 1_000_000) - 0.5) < 1e-9);
	assert.ok(
		Math.abs(calculateCost("openai/text-embedding-3-small", 1_000_000, 0) - 0.02) <
			1e-9,
	);
});

test("calculateCost rejects unknown models instead of guessing a price", () => {
	assert.throws(() => calculateCost("evil/expensive-model", 1000, 1000), {
		message: /Unknown model/,
	});
});

test("known model checks", () => {
	assert.equal(isKnownChatModel(MODEL), true);
	assert.equal(isKnownChatModel("openai/text-embedding-3-small"), false);
	assert.equal(isKnownEmbeddingModel("openai/text-embedding-3-small"), true);
	assert.equal(isKnownEmbeddingModel("nope"), false);
});

test("estimateChatCost covers the prompt and the full output cap", () => {
	const estimate = estimateChatCost(MODEL, 100_000, 32_000);
	assert.ok(Math.abs(estimate - calculateCost(MODEL, 100_000, 32_000)) < 1e-12);
	// A long prompt must cost more than a short one
	assert.ok(estimate > estimateChatCost(MODEL, 100, 32_000));
});

test("resolveChatCost bills reported usage", () => {
	const r = resolveChatCost({
		modelId: MODEL,
		usage: { inputTokens: 1000, outputTokens: 500 },
		reservedAmount: 1,
	});
	assert.equal(r.usageKnown, true);
	assert.ok(Math.abs(r.cost - calculateCost(MODEL, 1000, 500)) < 1e-12);
});

test("resolveChatCost charges the whole reservation when usage is missing", () => {
	for (const usage of [null, undefined, { inputTokens: 0, outputTokens: 0 }]) {
		const r = resolveChatCost({ modelId: MODEL, usage, reservedAmount: 0.42 });
		assert.deepEqual(r, { cost: 0.42, usageKnown: false });
	}
});

test("computeSettlement refunds an over-reservation", () => {
	assert.deepEqual(computeSettlement(0.01, 0.004), {
		kind: "refund",
		amount: 0.01 - 0.004,
	});
});

test("computeSettlement charges the shortfall of an under-reservation", () => {
	const s = computeSettlement(0.001, 0.01);
	assert.equal(s.kind, "charge");
	assert.ok(Math.abs(s.amount - 0.009) < 1e-12);
});

test("computeSettlement ignores differences below column precision", () => {
	assert.deepEqual(computeSettlement(0.5, 0.5), { kind: "none", amount: 0 });
	assert.deepEqual(computeSettlement(0.5, 0.5 + CREDIT_EPSILON / 10), {
		kind: "none",
		amount: 0,
	});
});

test("computeSettlement with no reservation charges the full cost", () => {
	assert.deepEqual(computeSettlement(0, 0.003), { kind: "charge", amount: 0.003 });
});
