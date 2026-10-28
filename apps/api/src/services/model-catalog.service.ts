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

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const REDIS_KEY = "openrouter:model_catalog";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // at most daily
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // retry hourly after a failure
const FETCH_TIMEOUT_MS = 15_000;
// A shorter list is treated as a broken response, not as models being removed
const MIN_CHAT_MODELS = 20;

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
	) as PriceOverride[];
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
 * `:batch` variants, `~` alias ids, models without text output and models
 * that cannot be billed by token (missing, zero or per-request pricing).
 */
export const parseChatModels = (body: unknown): ChatModel[] => {
	const list = (body as { data?: unknown } | null)?.data;
	if (!Array.isArray(list))
		throw new Error("OpenRouter models response has no data array");

	const models: ChatModel[] = [];
	for (const model of list as OpenRouterApiModel[]) {
		const id = model?.id;
		if (typeof id !== "string" || !id) continue;
		if (id.includes(":batch") || id.startsWith("~")) continue;
		if (!outputsText(model)) continue;

		const contextLength = model.context_length;
		if (typeof contextLength !== "number" || contextLength <= 0) continue;

		const pricing = parsePricing(model.pricing);
		if (!pricing) continue;

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

const isUsable = (m: ChatModel): boolean =>
	typeof m?.id === "string" && m.inputPrice > 0 && m.outputPrice > 0;

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
})).filter(isUsable);

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
let lastFetchedAt = 0;

const useChatModels = (models: ChatModel[]): void => {
	chatModels = models;
	chatModelsById = new Map(models.map((m) => [m.id, m]));
};

// ============================================================================
// Fetch & refresh logic
// ============================================================================

async function fetchChatModels(): Promise<ChatModel[]> {
	const res = await fetch(OPENROUTER_MODELS_URL, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`OpenRouter models API returned ${res.status}`);
	}

	const models = parseChatModels(await res.json());
	if (models.length < MIN_CHAT_MODELS) {
		throw new Error(
			`OpenRouter models API returned only ${models.length} usable chat models`,
		);
	}
	return models;
}

/**
 * Fetch the chat model list from OpenRouter. On failure the current list
 * (last good copy, or the static fallback) stays in use.
 */
export async function refreshModelCatalog(
	redis: Pick<Redis, "set">,
): Promise<void> {
	try {
		const models = await fetchChatModels();
		useChatModels(models);
		lastFetchedAt = Date.now();

		// No expiry: this is the last good copy when OpenRouter is unreachable
		const stored: StoredCatalog = { fetchedAt: lastFetchedAt, models };
		await redis.set(REDIS_KEY, JSON.stringify(stored));

		console.log(`[Models] Loaded ${models.length} chat models from OpenRouter`);
	} catch (err) {
		console.error(
			"[Models] Failed to refresh from OpenRouter — keeping the current list:",
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
 * 2. Loads the last good copy from Redis
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
				? stored.models.filter(isUsable)
				: [];
			if (models.length >= MIN_CHAT_MODELS) {
				useChatModels(models);
				lastFetchedAt = Number(stored.fetchedAt) || 0;
				console.log(`[Models] Loaded ${models.length} chat models from Redis`);
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

/** Chat models a profile can use, newest first. */
export const listChatModels = (): readonly ChatModel[] => chatModels;

export const getChatModel = (modelId: string): ChatModel | undefined =>
	chatModelsById.get(modelId);

/**
 * Current pricing of a chat or embedding model.
 * Returns undefined for an unknown model.
 */
export const getModelPricing = (modelId: string): ModelPricing | undefined =>
	chatModelsById.get(modelId) ?? EMBEDDING_PRICES.get(modelId);
