import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
	getModelPricing,
	initModelCatalog,
	listChatModels,
	parseChatModels,
	parsePricing,
	refreshModelCatalog,
} from "./model-catalog.service";
import { calculateCost, isKnownChatModel } from "../utils/cost";

// Minimal OpenRouter /models entry: $0.10 in, $0.50 out per 1M
const apiModel = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	name: `Name of ${id}`,
	created: 1_700_000_000,
	context_length: 200_000,
	architecture: { output_modalities: ["text"] },
	pricing: { prompt: "0.0000001", completion: "0.0000005" },
	...overrides,
});

// A response long enough to pass the broken-response floor
const filler = Array.from({ length: 25 }, (_, i) =>
	apiModel(`vendor/filler-${i}`, { created: 1_600_000_000 + i }),
);

const fakeRedis = (stored: string | null = null) => {
	const writes: string[] = [];
	return {
		writes,
		get: async () => stored,
		set: async (_key: string, value: string) => {
			writes.push(value);
			return "OK" as const;
		},
	};
};

const mockFetch = (body: unknown, status = 200) =>
	mock.method(globalThis, "fetch", async () =>
		new Response(JSON.stringify(body), { status }),
	);

test("parseChatModels keeps priced text models, newest first, prices per 1M", () => {
	const models = parseChatModels({
		data: [
			apiModel("a/old", { created: 100 }),
			apiModel("a/new", { created: 200 }),
		],
	});
	assert.deepEqual(
		models.map((m) => m.id),
		["a/new", "a/old"],
	);
	assert.equal(models[0].inputPrice, 0.1);
	assert.equal(models[0].outputPrice, 0.5);
	assert.equal(models[0].name, "Name of a/new");
	assert.equal(models[0].contextLength, 200_000);
});

test("parseChatModels drops batch, alias, non-text and unbillable models", () => {
	const models = parseChatModels({
		data: [
			apiModel("a/keep"),
			apiModel("a/keep:batch"),
			apiModel("~a/keep-latest"),
			apiModel("a/image-only", {
				architecture: { output_modalities: ["image"] },
			}),
			apiModel("a/free", { pricing: { prompt: "0", completion: "0" } }),
			apiModel("a/half-free", {
				pricing: { prompt: "0.0000001", completion: "0" },
			}),
			apiModel("a/unpriced", { pricing: {} }),
			apiModel("a/router", { pricing: { prompt: "-1", completion: "-1" } }),
			apiModel("a/garbage", { pricing: { prompt: "abc", completion: "1" } }),
			apiModel("a/per-request", {
				pricing: {
					prompt: "0.0000001",
					completion: "0.0000005",
					request: "0.01",
				},
			}),
			apiModel("a/no-context", { context_length: 0 }),
			{ name: "no id" },
		],
	});
	assert.deepEqual(
		models.map((m) => m.id),
		["a/keep"],
	);
});

test("parseChatModels reads the modality string when output_modalities is absent", () => {
	const models = parseChatModels({
		data: [
			apiModel("a/text", { architecture: { modality: "text+image->text" } }),
			apiModel("a/image", { architecture: { modality: "text->image" } }),
		],
	});
	assert.deepEqual(
		models.map((m) => m.id),
		["a/text"],
	);
});

test("parseChatModels rejects a response without a data array", () => {
	assert.throws(() => parseChatModels({ error: "nope" }));
	assert.throws(() => parseChatModels(null));
});

test("parsePricing keeps prompt-size tiers and never lowers a price", () => {
	const pricing = parsePricing({
		prompt: "0.0000001",
		completion: "0.0000005",
		internal_reasoning: "0.000001",
		overrides: [
			{ min_prompt_tokens: 200_000, prompt: "0.000001", completion: "0.000005" },
			{ min_prompt_tokens: 100_000, prompt: "0.0000005", completion: "0.0000025" },
			// Time-window discount: billed at the base price
			{ utc_days: ["saturday"], prompt: "0.00000005", completion: "0.0000002" },
			// Time-window surcharge: raises the base price
			{ utc_start: 0, utc_end: 100, prompt: "0.0000002", completion: "0.0000005" },
		],
	});
	assert.deepEqual(pricing, {
		inputPrice: 0.2,
		// internal_reasoning is higher than completion
		outputPrice: 1,
		tiers: [
			{ minPromptTokens: 100_000, inputPrice: 0.5, outputPrice: 2.5 },
			{ minPromptTokens: 200_000, inputPrice: 1, outputPrice: 5 },
		],
	});
});

test("the static list prices models before any fetch", () => {
	assert.equal(isKnownChatModel("anthropic/claude-haiku-5.5"), true);
	assert.deepEqual(getModelPricing("anthropic/claude-haiku-5.5"), {
		id: "anthropic/claude-haiku-5.5",
		name: "anthropic/claude-haiku-5.5",
		contextLength: 1_000_000,
		created: 0,
		inputPrice: 0.1,
		outputPrice: 0.5,
	});
	assert.equal(getModelPricing("openai/text-embedding-3-small")?.inputPrice, 0.02);
});

test("a failed or short fetch keeps the current list", async (t) => {
	const before = listChatModels();

	t.mock.method(console, "error", () => {});
	const failing = mockFetch({ error: "down" }, 500);
	await refreshModelCatalog(fakeRedis());
	failing.mock.restore();
	assert.equal(listChatModels(), before);

	const short = mockFetch({ data: [apiModel("a/only-one")] });
	const redis = fakeRedis();
	await refreshModelCatalog(redis);
	short.mock.restore();
	assert.equal(listChatModels(), before);
	assert.equal(redis.writes.length, 0);
});

test("a fetch replaces the list, stores it in Redis and prices at call time", async (t) => {
	t.mock.method(console, "log", () => {});
	const fetched = mockFetch({
		data: [
			...filler,
			apiModel("vendor/tiered", {
				pricing: {
					prompt: "0.000001",
					completion: "0.000002",
					overrides: [
						{ min_prompt_tokens: 100_000, prompt: "0.000002", completion: "0.000004" },
					],
				},
			}),
			apiModel("vendor/free", { pricing: { prompt: "0", completion: "0" } }),
		],
	});
	const redis = fakeRedis();
	await refreshModelCatalog(redis);
	fetched.mock.restore();

	assert.equal(listChatModels().length, 26);
	assert.equal(listChatModels()[0].id, "vendor/tiered");

	// Stored with its fetch time: the last good copy for the next start
	assert.equal(redis.writes.length, 1);
	const stored = JSON.parse(redis.writes[0]);
	assert.equal(stored.models.length, 26);
	assert.ok(stored.fetchedAt > 0);

	// Billing follows the fetched list, not the static one
	assert.equal(isKnownChatModel("vendor/tiered"), true);
	assert.equal(isKnownChatModel("google/gemini-2.5-flash-lite"), false);
	assert.equal(calculateCost("vendor/tiered", 1000, 1000), 0.003);
	// Prompt of 100k tokens or more: the whole call at the tier price
	assert.equal(calculateCost("vendor/tiered", 100_000, 1000), 0.204);

	// Unpriced or unknown ids are refused, never billed 0
	assert.equal(isKnownChatModel("vendor/free"), false);
	assert.throws(() => calculateCost("vendor/free", 1000, 1000), {
		message: /Unknown model/,
	});
	assert.throws(() => calculateCost("vendor/missing", 1000, 1000), {
		message: /Unknown model/,
	});
	// Embedding prices stay on the static list
	assert.equal(getModelPricing("openai/text-embedding-3-small")?.inputPrice, 0.02);
});

test("init loads a fresh Redis copy without fetching", async (t) => {
	t.mock.method(console, "log", () => {});
	const fetchSpy = mockFetch({ data: [] });
	const models = parseChatModels({
		data: Array.from({ length: 20 }, (_, i) => apiModel(`cached/m-${i}`)),
	});
	await initModelCatalog(
		fakeRedis(JSON.stringify({ fetchedAt: Date.now(), models })),
	);
	fetchSpy.mock.restore();

	assert.equal(fetchSpy.mock.callCount(), 0);
	assert.equal(isKnownChatModel("cached/m-0"), true);
	assert.equal(isKnownChatModel("vendor/tiered"), false);
});
