import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_CHAT_MODEL,
	DELIST_GRACE_MS,
	getModelPricing,
	initModelCatalog,
	isListedChatModel,
	listChatModels,
	mergeChatModels,
	parseChatModels,
	parsePricing,
	refreshModelCatalog,
	type ChatModel,
} from "./model-catalog.service";
import { calculateCost, isKnownChatModel } from "../utils/cost";
import { isAcceptableModelChange } from "../utils/profile_schema";

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

const priced = (prompt: string, completion: string) => ({
	pricing: { prompt, completion },
});

// A response long enough to pass the broken-response floor
const filler = Array.from({ length: 25 }, (_, i) =>
	apiModel(`vendor/filler-${i}`, { created: 1_600_000_000 + i }),
);

const chatModel = (id: string, extra: Partial<ChatModel> = {}): ChatModel => ({
	id,
	name: id,
	contextLength: 1000,
	created: 1,
	inputPrice: 1,
	outputPrice: 2,
	...extra,
});

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
		new Response(typeof body === "string" ? body : JSON.stringify(body), {
			status,
		}),
	);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

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
			apiModel("a/free", priced("0", "0")),
			apiModel("a/half-free", priced("0.0000001", "0")),
			apiModel("a/unpriced", { pricing: {} }),
			apiModel("a/router", priced("-1", "-1")),
			apiModel("a/garbage", priced("abc", "1")),
			apiModel("a/per-request", {
				pricing: {
					prompt: "0.0000001",
					completion: "0.0000005",
					request: "0.01",
				},
			}),
			apiModel("a/no-context", { context_length: 0 }),
			{ name: "no id" },
			null,
		],
	});
	assert.deepEqual(
		models.map((m) => m.id),
		["a/keep"],
	);
});

test("parseChatModels bounds ids, prices and the list size", () => {
	const models = parseChatModels({
		data: [
			apiModel("a/keep"),
			apiModel(`a/${"x".repeat(199)}`),
			// Below $0.001 and above $1000 per 1M
			apiModel("a/too-cheap", priced("0.0000000001", "0.0000005")),
			apiModel("a/too-dear", priced("0.0000001", "0.002")),
			apiModel("a/dear-tier", {
				pricing: {
					prompt: "0.0000001",
					completion: "0.0000005",
					overrides: [{ min_prompt_tokens: 1000, prompt: "0.01", completion: "0.01" }],
				},
			}),
			// Exactly on the band edges is kept
			apiModel("a/edges", priced("0.000000001", "0.001")),
		],
	});
	assert.deepEqual(
		models.map((m) => m.id).sort(),
		["a/edges", "a/keep"],
	);

	const tooMany = Array.from({ length: 5001 }, (_, i) => apiModel(`a/m-${i}`));
	assert.throws(() => parseChatModels({ data: tooMany }), /5001 models/);
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

test("parsePricing skips overrides that are not objects", () => {
	const pricing = parsePricing({
		prompt: "0.0000001",
		completion: "0.0000005",
		overrides: [
			null,
			"oops",
			42,
			{ min_prompt_tokens: 100_000, prompt: "0.0000005", completion: "0.0000025" },
		],
	});
	assert.deepEqual(pricing, {
		inputPrice: 0.1,
		outputPrice: 0.5,
		tiers: [{ minPromptTokens: 100_000, inputPrice: 0.5, outputPrice: 2.5 }],
	});
});

// ---------------------------------------------------------------------------
// Merging a fetched list into the current one
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const current = Array.from({ length: 10 }, (_, i) => chatModel(`v/m-${i}`));

test("mergeChatModels takes the fetched list as is over the static list", () => {
	const fetched = [chatModel("v/new")];
	const { models, warnings } = mergeChatModels(current, fetched, {
		currentIsFetched: false,
		now: NOW,
	});
	assert.deepEqual(models, fetched);
	assert.deepEqual(warnings, []);
});

test("mergeChatModels rejects a list that drops over 30% of the listed models", () => {
	// 4 of 10 dropped
	assert.throws(
		() =>
			mergeChatModels(current, current.slice(4), {
				currentIsFetched: true,
				now: NOW,
			}),
		/drops 4 of 10/,
	);
	// 3 of 10 is allowed; delisted ones do not count as listed
	assert.doesNotThrow(() =>
		mergeChatModels(
			[...current, chatModel("v/old", { delistedAt: NOW - 1000 })],
			current.slice(3),
			{ currentIsFetched: true, now: NOW },
		),
	);
});

test("mergeChatModels keeps the previous price on a cut over 10x, applies a rise", () => {
	const fetched = current.map((m, i) =>
		i === 0
			? { ...m, inputPrice: 0.05 } // 20x cheaper input
			: i === 1
				? { ...m, outputPrice: 50 } // 25x dearer output
				: m,
	);
	const { models, warnings } = mergeChatModels(current, fetched, {
		currentIsFetched: true,
		now: NOW,
	});
	assert.equal(models[0].inputPrice, 1);
	assert.equal(models[1].outputPrice, 50);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /v\/m-0: price cut/);
});

test("mergeChatModels keeps a delisted model for 14 days with its last prices", () => {
	const gone = chatModel("v/gone", { inputPrice: 3, outputPrice: 4 });
	const first = mergeChatModels([...current, gone], current, {
		currentIsFetched: true,
		now: NOW,
	});
	const kept = first.models.find((m) => m.id === "v/gone");
	assert.deepEqual(kept, { ...gone, delistedAt: NOW });
	assert.match(first.warnings[0], /v\/gone: no longer listed/);

	// Still missing a day before the end of the grace period: kept, same date
	const later = mergeChatModels(first.models, current, {
		currentIsFetched: true,
		now: NOW + DELIST_GRACE_MS - 86_400_000,
	});
	assert.equal(later.models.find((m) => m.id === "v/gone")?.delistedAt, NOW);

	// After 14 days: dropped
	const expired = mergeChatModels(first.models, current, {
		currentIsFetched: true,
		now: NOW + DELIST_GRACE_MS,
	});
	assert.equal(expired.models.some((m) => m.id === "v/gone"), false);

	// Listed again: back to normal
	const back = mergeChatModels(first.models, [...current, gone], {
		currentIsFetched: true,
		now: NOW + 1000,
	});
	assert.equal(back.models.find((m) => m.id === "v/gone")?.delistedAt, undefined);
});

// ---------------------------------------------------------------------------
// The live catalog (module state: these tests run in order)
// ---------------------------------------------------------------------------

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

test("a failed, oversized or short fetch keeps the current list", async (t) => {
	const before = listChatModels();
	t.mock.method(console, "error", () => {});

	const failing = mockFetch({ error: "down" }, 500);
	await refreshModelCatalog(fakeRedis());
	failing.mock.restore();
	assert.deepEqual(listChatModels(), before);

	// A valid list, but over 5 MB
	const huge = mockFetch({
		data: [...filler, apiModel("vendor/huge", { name: "x".repeat(5_300_000) })],
	});
	await refreshModelCatalog(fakeRedis());
	huge.mock.restore();
	assert.deepEqual(listChatModels(), before);

	const short = mockFetch({ data: [apiModel("a/only-one")] });
	const redis = fakeRedis();
	await refreshModelCatalog(redis);
	short.mock.restore();
	assert.deepEqual(listChatModels(), before);
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
			apiModel("vendor/free", priced("0", "0")),
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
	assert.equal(isKnownChatModel("openai/gpt-5"), false);
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

test("the default chat model always resolves, from the static list if need be", () => {
	assert.equal(isListedChatModel(DEFAULT_CHAT_MODEL), false);
	assert.equal(isKnownChatModel(DEFAULT_CHAT_MODEL), true);
	assert.equal(getModelPricing(DEFAULT_CHAT_MODEL)?.inputPrice, 0.1);
});

test("a delisted model keeps working for chat but cannot be newly chosen", async (t) => {
	t.mock.method(console, "log", () => {});
	t.mock.method(console, "warn", () => {});
	// vendor/tiered disappears from the next list
	const fetched = mockFetch({ data: filler });
	await refreshModelCatalog(fakeRedis());
	fetched.mock.restore();

	assert.equal(isKnownChatModel("vendor/tiered"), true);
	assert.equal(calculateCost("vendor/tiered", 1000, 1000), 0.003);
	assert.equal(isListedChatModel("vendor/tiered"), false);
	assert.equal(
		listChatModels().some((m) => m.id === "vendor/tiered"),
		false,
	);

	// Profiles: keeping the stored model is fine, switching to it is not
	assert.equal(isAcceptableModelChange("vendor/tiered", "vendor/tiered"), true);
	assert.equal(isAcceptableModelChange(undefined, "vendor/tiered"), true);
	assert.equal(isAcceptableModelChange("vendor/tiered", "vendor/filler-0"), false);
	assert.equal(isAcceptableModelChange("vendor/filler-1", "vendor/tiered"), true);
	assert.equal(isAcceptableModelChange("evil/expensive-model"), false);
});

test("init loads a fresh Redis copy without fetching, re-checking each model", async (t) => {
	t.mock.method(console, "log", () => {});
	const fetchSpy = mockFetch({ data: [] });
	const models = parseChatModels({
		data: Array.from({ length: 20 }, (_, i) => apiModel(`cached/m-${i}`)),
	});
	const broken = [
		{ ...models[0], id: "cached/no-context", contextLength: 0 },
		{ ...models[0], id: "cached/bad-tiers", tiers: "nope" },
		{ ...models[0], id: "cached/free", inputPrice: 0 },
		null,
	];
	await initModelCatalog(
		fakeRedis(
			JSON.stringify({ fetchedAt: Date.now(), models: [...models, ...broken] }),
		),
	);
	fetchSpy.mock.restore();

	assert.equal(fetchSpy.mock.callCount(), 0);
	assert.equal(isKnownChatModel("cached/m-0"), true);
	assert.equal(isKnownChatModel("cached/no-context"), false);
	assert.equal(isKnownChatModel("cached/bad-tiers"), false);
	assert.equal(isKnownChatModel("cached/free"), false);
	assert.equal(isKnownChatModel("vendor/tiered"), false);
});
