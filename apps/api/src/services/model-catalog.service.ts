import { describeError } from "../config/redact";
import type Redis from "ioredis";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "@repo/llm/openrouter/models";

// ============================================================================
// Types
// ============================================================================

/** Price for a prompt of at least `minPromptTokens` tokens. */
export type PriceTier = {
	minPromptTokens: number;
	inputPrice: number; // $/1M tokens
	outputPrice: number; // $/1M tokens
};

export type ModelPricing = {
	inputPrice: number; // $/1M tokens
	outputPrice: number; // $/1M tokens
	tiers?: PriceTier[]; // ascending by minPromptTokens
};

export type ChatModel = ModelPricing & {
	id: string;
	name: string;
	contextLength: number;
	created: number; // unix seconds, 0 for the static fallback
	// Set when OpenRouter stopped listing the model (ms). It then still works
	// for existing profiles during a grace period, but cannot be newly chosen.
	delistedAt?: number;
};

// OpenRouter API response shape (only fields we care about). Prices are USD
// per token as strings (e.g. "0.000001" = $1/M).
type OpenRouterApiModel = {
	id?: unknown;
	name?: unknown;
	created?: unknown;
	context_length?: unknown;
	architecture?: { output_modalities?: unknown; modality?: unknown };
	pricing?: {
		prompt?: unknown;
		completion?: unknown;
		request?: unknown;
		internal_reasoning?: unknown;
		overrides?: unknown;
	};
};

type PriceOverride = {
	prompt?: unknown;
	completion?: unknown;
	min_prompt_tokens?: unknown;
	utc_start?: unknown;
	utc_end?: unknown;
	utc_days?: unknown;
};

type StoredCatalog = { fetchedAt: number; models: ChatModel[] };

// ============================================================================
// Constants
// ============================================================================

/**
 * Chat model of a new profile that does not choose one, and of chat without a
 * profile. Must stay in the static list so it always resolves.
 */
export const DEFAULT_CHAT_MODEL = "anthropic/claude-haiku-5.5";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const REDIS_KEY = "openrouter:model_catalog";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // at most daily
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // retry hourly after a failure
const FETCH_TIMEOUT_MS = 15_000;

// Bounds on what OpenRouter sends: anything outside is a broken response
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_MODELS = 5000;
const MAX_ID_LENGTH = 200;
// A shorter list is treated as a broken response, not as models being removed
const MIN_CHAT_MODELS = 20;
// Prices outside this band ($/1M) are treated as bad data for that model
const MIN_PRICE = 0.001;
const MAX_PRICE = 1000;

// Against the previous fetched list: a list that drops more than this share of
// the listed models is rejected, and a price cut beyond this factor is not applied
const MAX_DROP_RATIO = 0.3;
const MAX_PRICE_CUT = 10;
// How long a delisted model keeps working for the profiles that use it
export const DELIST_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// ============================================================================
// Parsing
// ============================================================================

/** USD per token (string or number) to USD per 1M tokens; undefined unless > 0. */
const perMillion = (perToken: unknown): number | undefined => {
	if (typeof perToken !== "string" && typeof perToken !== "number")
		return undefined;
	const value = Number(perToken);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	// Rounded so "0.0000001" gives 0.1, not 0.09999999999999999
	return Number((value * 1_000_000).toPrecision(12));
};

const inBand = (price: unknown): boolean =>
	typeof price === "number" && price >= MIN_PRICE && price <= MAX_PRICE;

/** Every price of the model (base and tiers) is inside the accepted band. */
const pricesInBand = (pricing: ModelPricing): boolean =>
	inBand(pricing.inputPrice) &&
	inBand(pricing.outputPrice) &&
	(pricing.tiers ?? []).every(
		(t) =>
			typeof t?.minPromptTokens === "number" &&
			t.minPromptTokens > 0 &&
			inBand(t.inputPrice) &&
			inBand(t.outputPrice),
	);

const outputsText = (model: OpenRouterApiModel): boolean => {
	const outputs = model.architecture?.output_modalities;
	if (Array.isArray(outputs)) return outputs.includes("text");
	const modality = model.architecture?.modality;
	if (typeof modality !== "string") return false;
	return modality.split("->")[1]?.split("+").includes("text") ?? false;
};

/**
 * Token prices of a model, or undefined when it cannot be billed by token.
 * Never returns a lower price than OpenRouter may charge: reasoning tokens use
 * the higher of the two output prices, and overrides other than prompt-size
 * tiers (time windows, today all discounts) raise the base price if higher.
 */
export const parsePricing = (
	pricing: OpenRouterApiModel["pricing"],
): ModelPricing | undefined => {
	const input = perMillion(pricing?.prompt);
	const completion = perMillion(pricing?.completion);
	if (input === undefined || completion === undefined) return undefined;

	// A per-request fee is not billed by token: refuse rather than undercharge
	if (perMillion(pricing?.request) !== undefined) return undefined;

	let inputPrice = input;
	let outputPrice = Math.max(
		completion,
		perMillion(pricing?.internal_reasoning) ?? 0,
	);

	const overrides = (
		Array.isArray(pricing?.overrides) ? pricing.overrides : []
	).filter(
		(o): o is PriceOverride => typeof o === "object" && o !== null,
	);
	const isTier = (o: PriceOverride) =>
		typeof o.min_prompt_tokens === "number" &&
		o.min_prompt_tokens > 0 &&
		o.utc_start === undefined &&
		o.utc_end === undefined &&
		o.utc_days === undefined;

	for (const o of overrides) {
		if (isTier(o)) continue;
		inputPrice = Math.max(inputPrice, perMillion(o.prompt) ?? 0);
		outputPrice = Math.max(outputPrice, perMillion(o.completion) ?? 0);
	}

	const tiers = overrides
		.filter(isTier)
		.map((o) => ({
			minPromptTokens: o.min_prompt_tokens as number,
			inputPrice: Math.max(inputPrice, perMillion(o.prompt) ?? 0),
			outputPrice: Math.max(outputPrice, perMillion(o.completion) ?? 0),
		}))
		.sort((a, b) => a.minPromptTokens - b.minPromptTokens);

	return tiers.length > 0
		? { inputPrice, outputPrice, tiers }
		: { inputPrice, outputPrice };
};

/**
 * Chat models from an OpenRouter /models response, newest first. Skips
 * `:batch` variants, `~` alias ids, overlong ids, models without text output,
 * and models that cannot be billed by token (missing, zero or per-request
 * pricing) or whose prices fall outside $0.001-$1000 per 1M tokens.
 */
export const parseChatModels = (body: unknown): ChatModel[] => {
	const list = (body as { data?: unknown } | null)?.data;
	if (!Array.isArray(list))
		throw new Error("OpenRouter models response has no data array");
	if (list.length > MAX_MODELS)
		throw new Error(`OpenRouter models response lists ${list.length} models`);

	const models: ChatModel[] = [];
	for (const model of list as OpenRouterApiModel[]) {
		const id = model?.id;
		if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) continue;
		if (id.includes(":batch") || id.startsWith("~")) continue;
		if (!outputsText(model)) continue;

		const contextLength = model.context_length;
		if (typeof contextLength !== "number" || contextLength <= 0) continue;

		const pricing = parsePricing(model.pricing);
		if (!pricing || !pricesInBand(pricing)) continue;

		models.push({
			id,
			name: typeof model.name === "string" && model.name ? model.name : id,
			contextLength,
			created: typeof model.created === "number" ? model.created : 0,
			...pricing,
		});
	}

	return models.sort((a, b) => b.created - a.created);
};

/** Shape check for a model read back from Redis. */
const isValidChatModel = (m: ChatModel): boolean =>
	typeof m === "object" &&
	m !== null &&
	typeof m.id === "string" &&
	m.id.length > 0 &&
	m.id.length <= MAX_ID_LENGTH &&
	typeof m.name === "string" &&
	typeof m.contextLength === "number" &&
	m.contextLength > 0 &&
	typeof m.created === "number" &&
	(m.tiers === undefined || Array.isArray(m.tiers)) &&
	(m.delistedAt === undefined || typeof m.delistedAt === "number") &&
	pricesInBand(m);

/**
 * The next list from a fetched one, checked against the current list when
 * that came from OpenRouter (the static list may simply be old).
 *
 * - Throws, so the current list stays, when the fetched one drops more than
 *   30% of the listed models.
 * - A price cut of more than 10x is not applied, per field: that price stays at
 *   the previous, higher one. Everything else is the fetched data, tiers
 *   included (raised to the kept base price). A billed price is therefore never
 *   below the fetched one; a rise is always applied.
 * - A model no longer listed keeps working with its last prices for 14 days.
 */
export const mergeChatModels = (
	current: readonly ChatModel[],
	fetched: ChatModel[],
	options: { currentIsFetched: boolean; now: number },
): { models: ChatModel[]; warnings: string[] } => {
	if (!options.currentIsFetched) return { models: fetched, warnings: [] };

	const fetchedIds = new Set(fetched.map((m) => m.id));
	const listed = current.filter((m) => m.delistedAt === undefined);
	const dropped = listed.filter((m) => !fetchedIds.has(m.id)).length;
	if (listed.length > 0 && dropped / listed.length > MAX_DROP_RATIO) {
		throw new Error(
			`OpenRouter models response drops ${dropped} of ${listed.length} listed models`,
		);
	}

	const warnings: string[] = [];
	const currentById = new Map(current.map((m) => [m.id, m]));
	const models = fetched.map((m) => {
		const previous = currentById.get(m.id);
		if (!previous) return m;
		const keepInput = m.inputPrice * MAX_PRICE_CUT < previous.inputPrice;
		const keepOutput = m.outputPrice * MAX_PRICE_CUT < previous.outputPrice;
		if (!keepInput && !keepOutput) return m;

		const inputPrice = keepInput
			? Math.max(m.inputPrice, previous.inputPrice)
			: m.inputPrice;
		const outputPrice = keepOutput
			? Math.max(m.outputPrice, previous.outputPrice)
			: m.outputPrice;
		warnings.push(
			`${m.id}: price cut over ${MAX_PRICE_CUT}x (${previous.inputPrice}/${previous.outputPrice} to ${m.inputPrice}/${m.outputPrice} per 1M), billing ${inputPrice}/${outputPrice}`,
		);
		return {
			...m,
			inputPrice,
			outputPrice,
			...(m.tiers && {
				tiers: m.tiers.map((t) => ({
					...t,
					inputPrice: Math.max(t.inputPrice, inputPrice),
					outputPrice: Math.max(t.outputPrice, outputPrice),
				})),
			}),
		};
	});

	for (const m of current) {
		if (fetchedIds.has(m.id)) continue;
		const delistedAt = m.delistedAt ?? options.now;
		if (options.now - delistedAt >= DELIST_GRACE_MS) continue;
		warnings.push(
			`${m.id}: no longer listed by OpenRouter, still usable until ${new Date(delistedAt + DELIST_GRACE_MS).toISOString()}`,
		);
		models.push({ ...m, delistedAt });
	}

	return { models, warnings };
};

// ============================================================================
// In-memory catalog (static fallback until a fetched or Redis copy replaces it)
// ============================================================================

const STATIC_CHAT_MODELS: ChatModel[] = OPENROUTER_AI_MODELS.map((m) => ({
	id: m.id,
	name: m.id,
	contextLength: m.contextLength,
	created: 0,
	inputPrice: m.inputPrice,
	outputPrice: m.outputPrice,
})).filter((m) => m.inputPrice > 0 && m.outputPrice > 0);

// The default model always resolves, from the static list if need be
const STATIC_DEFAULT_CHAT_MODEL = STATIC_CHAT_MODELS.find(
	(m) => m.id === DEFAULT_CHAT_MODEL,
);

// Embedding models stay a static allow-list: OpenRouter's /models lists no
// embedding models, and each one needs a known vector size for Qdrant
const EMBEDDING_PRICES = new Map<string, ModelPricing>(
	OPENROUTER_EMBEDDING_MODELS.map((m) => [
		m.id,
		{ inputPrice: m.inputPrice, outputPrice: m.outputPrice },
	]),
);

let chatModels: ChatModel[] = STATIC_CHAT_MODELS;
let chatModelsById = new Map(chatModels.map((m) => [m.id, m]));
// Time of the fetch the current list comes from; 0 while it is the static list
let lastFetchedAt = 0;

const useChatModels = (models: ChatModel[]): void => {
	chatModels = models;
	chatModelsById = new Map(models.map((m) => [m.id, m]));
};

// ============================================================================
// Fetch & refresh logic
// ============================================================================

/** Parse a JSON body, refusing one larger than `maxBytes`. */
async function readJsonCapped(res: Response, maxBytes: number): Promise<unknown> {
	if (Number(res.headers.get("content-length")) > maxBytes) {
		throw new Error(`OpenRouter models response is over ${maxBytes} bytes`);
	}
	if (!res.body) throw new Error("OpenRouter models response has no body");

	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			throw new Error(`OpenRouter models response is over ${maxBytes} bytes`);
		}
		chunks.push(value);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchChatModels(): Promise<ChatModel[]> {
	const res = await fetch(OPENROUTER_MODELS_URL, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`OpenRouter models API returned ${res.status}`);
	}

	const models = parseChatModels(await readJsonCapped(res, MAX_BODY_BYTES));
	if (models.length < MIN_CHAT_MODELS) {
		throw new Error(
			`OpenRouter models API returned only ${models.length} usable chat models`,
		);
	}
	return models;
}

/**
 * Fetch the chat model list from OpenRouter. On failure, or when the new list
 * looks broken, the current list (last good copy, or the static fallback)
 * stays in use.
 */
export async function refreshModelCatalog(
	redis: Pick<Redis, "set">,
): Promise<void> {
	const now = Date.now();
	let stored: StoredCatalog;
	try {
		const fetched = await fetchChatModels();
		const { models, warnings } = mergeChatModels(chatModels, fetched, {
			currentIsFetched: lastFetchedAt > 0,
			now,
		});
		for (const warning of warnings) console.warn(`[Models] ${warning}`);

		useChatModels(models);
		lastFetchedAt = now;
		stored = { fetchedAt: now, models };
		console.log(`[Models] Loaded ${fetched.length} chat models from OpenRouter`);
	} catch (err) {
		console.error(
			"[Models] Failed to refresh from OpenRouter — keeping the current list:",
			describeError(err),
		);
		return;
	}

	// No expiry: this is the last good copy when OpenRouter is unreachable
	try {
		await redis.set(REDIS_KEY, JSON.stringify(stored));
	} catch (err) {
		console.error(
			"[Models] New list in use, but saving it to Redis failed:",
			describeError(err),
		);
	}
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the chat model catalog.
 *
 * 1. Starts from the static list (always safe)
 * 2. Loads the last good copy from Redis, re-checking each model's shape
 * 3. Fetches from OpenRouter when that copy is missing or older than a day
 *    (non-blocking), then checks hourly and refreshes at most daily
 */
export async function initModelCatalog(
	redis: Pick<Redis, "get" | "set">,
): Promise<void> {
	try {
		const cached = await redis.get(REDIS_KEY);
		if (cached) {
			const stored = JSON.parse(cached) as StoredCatalog;
			const models = Array.isArray(stored.models)
				? stored.models.filter(isValidChatModel)
				: [];
			const listed = models.filter((m) => m.delistedAt === undefined);
			if (listed.length >= MIN_CHAT_MODELS) {
				useChatModels(models);
				lastFetchedAt = Number(stored.fetchedAt) || 0;
				console.log(`[Models] Loaded ${listed.length} chat models from Redis`);
			}
		}
	} catch (err) {
		console.warn(
			"[Models] Could not load the Redis copy — will fetch from OpenRouter:",
			describeError(err),
		);
	}

	const refreshIfStale = () => {
		if (Date.now() - lastFetchedAt >= REFRESH_INTERVAL_MS) {
			void refreshModelCatalog(redis);
		}
	};
	refreshIfStale();
	// unref so the interval doesn't prevent process exit
	setInterval(refreshIfStale, CHECK_INTERVAL_MS).unref();
}

/** Chat models a profile can choose, newest first (delisted ones excluded). */
export const listChatModels = (): ChatModel[] =>
	chatModels.filter((m) => m.delistedAt === undefined);

/** A model a profile can newly choose. */
export const isListedChatModel = (modelId: string): boolean => {
	const model = chatModelsById.get(modelId);
	return model !== undefined && model.delistedAt === undefined;
};

/**
 * A model chat can run and bill: listed, delisted within the grace period, or
 * the default model.
 */
export const getChatModel = (modelId: string): ChatModel | undefined =>
	chatModelsById.get(modelId) ??
	(modelId === DEFAULT_CHAT_MODEL ? STATIC_DEFAULT_CHAT_MODEL : undefined);

/**
 * Current pricing of a chat or embedding model.
 * Returns undefined for an unknown model.
 */
export const getModelPricing = (modelId: string): ModelPricing | undefined =>
	getChatModel(modelId) ?? EMBEDDING_PRICES.get(modelId);
