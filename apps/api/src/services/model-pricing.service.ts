import Redis from "ioredis";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "@repo/llm/openrouter/models";

// ============================================================================
// Types
// ============================================================================

export type ModelPricing = {
	inputPrice: number; // $/1M tokens
	outputPrice: number; // $/1M tokens
};

// OpenRouter API response shape (only fields we care about)
type OpenRouterApiModel = {
	id: string;
	pricing?: {
		prompt?: string; // cost per token (e.g. "0.000001" = $1/M)
		completion?: string;
	};
};

// ============================================================================
// Constants
// ============================================================================

const REDIS_KEY = "openrouter:model_pricing";
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Set of model IDs we actually care about (from both static lists)
const KNOWN_MODEL_IDS = new Set<string>([
	...OPENROUTER_AI_MODELS.map((m) => m.id),
	...OPENROUTER_EMBEDDING_MODELS.map((m) => m.id),
]);

// ============================================================================
// In-memory cache (populated from Redis/API on startup, refreshed periodically)
// ============================================================================

const pricingCache = new Map<string, ModelPricing>();

/**
 * Seed the in-memory cache with values from the static model lists.
 * This ensures calculateCost() never falls through to the fallback
 * even before the first successful API fetch.
 */
function seedFromStaticData(): void {
	for (const m of OPENROUTER_AI_MODELS) {
		pricingCache.set(m.id, {
			inputPrice: m.inputPrice,
			outputPrice: m.outputPrice,
		});
	}
	for (const m of OPENROUTER_EMBEDDING_MODELS) {
		pricingCache.set(m.id, {
			inputPrice: m.inputPrice,
			outputPrice: m.outputPrice,
		});
	}
}

// ============================================================================
// Fetch & refresh logic
// ============================================================================

async function fetchFromOpenRouter(): Promise<Map<string, ModelPricing>> {
	const res = await fetch("https://openrouter.ai/api/v1/models");
	if (!res.ok) {
		throw new Error(`OpenRouter models API returned ${res.status}`);
	}

	const data = (await res.json()) as { data: OpenRouterApiModel[] };
	const updated = new Map<string, ModelPricing>();

	for (const model of data.data) {
		// Only update prices for models we already know about
		if (!KNOWN_MODEL_IDS.has(model.id)) continue;

		const inputPerToken = parseFloat(model.pricing?.prompt ?? "0");
		const outputPerToken = parseFloat(model.pricing?.completion ?? "0");

		if (isNaN(inputPerToken) || isNaN(outputPerToken)) continue;

		updated.set(model.id, {
			inputPrice: inputPerToken * 1_000_000,
			outputPrice: outputPerToken * 1_000_000,
		});
	}

	return updated;
}

async function refreshModelPricing(redis: Redis): Promise<void> {
	try {
		const fresh = await fetchFromOpenRouter();

		// Update in-memory cache
		for (const [id, pricing] of fresh) {
			pricingCache.set(id, pricing);
		}

		// Persist to Redis for the next startup (avoids cold-start API call)
		await redis.setex(
			REDIS_KEY,
			CACHE_TTL_SECONDS,
			JSON.stringify(Object.fromEntries(fresh)),
		);

		console.log(
			`[Pricing] Refreshed prices for ${fresh.size}/${KNOWN_MODEL_IDS.size} known models from OpenRouter`,
		);
	} catch (err) {
		console.error(
			"[Pricing] Failed to refresh from OpenRouter — retaining current cached/static prices:",
			err,
		);
	}
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the model pricing cache.
 *
 * 1. Seeds in-memory cache from static data (immediate, always safe)
 * 2. Loads persisted prices from Redis if available (fast, skips API call on warm restart)
 * 3. Fetches fresh prices from OpenRouter API (async, non-blocking after Redis load)
 * 4. Schedules a periodic refresh every 6 hours
 */
export async function initModelPricing(redis: Redis): Promise<void> {
	// Always start from static data so calculateCost() works immediately
	seedFromStaticData();
	console.log(
		`[Pricing] Seeded ${pricingCache.size} model prices from static data`,
	);

	// Try to hydrate from Redis (warm restart path)
	try {
		const cached = await redis.get(REDIS_KEY);
		if (cached) {
			const parsed = JSON.parse(cached) as Record<string, ModelPricing>;
			let count = 0;
			for (const [id, pricing] of Object.entries(parsed)) {
				if (KNOWN_MODEL_IDS.has(id)) {
					pricingCache.set(id, pricing);
					count++;
				}
			}
			console.log(`[Pricing] Hydrated ${count} model prices from Redis cache`);
		}
	} catch (err) {
		console.warn(
			"[Pricing] Could not load from Redis cache — will fetch from API:",
			err,
		);
	}

	// Fetch fresh prices from OpenRouter (don't await — server starts immediately)
	refreshModelPricing(redis).catch(() => {
		// already logged inside refreshModelPricing
	});

	// Periodic refresh every 6 hours
	setInterval(() => {
		refreshModelPricing(redis).catch(() => {});
	}, REFRESH_INTERVAL_MS).unref(); // unref so the interval doesn't prevent process exit
}

/**
 * Look up the live cached pricing for a model.
 * Returns undefined if the model is not in the cache (unknown model).
 */
export function getCachedModelPricing(
	modelId: string,
): ModelPricing | undefined {
	return pricingCache.get(modelId);
}
