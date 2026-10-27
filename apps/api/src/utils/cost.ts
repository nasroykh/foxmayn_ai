import { ORPCError } from "@orpc/server";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "@repo/llm/openrouter/models";
import { getCachedModelPricing } from "../services/model-pricing.service";

export const isKnownChatModel = (modelId: string): boolean =>
	OPENROUTER_AI_MODELS.some((m) => m.id === modelId);

export const isKnownEmbeddingModel = (modelId: string): boolean =>
	OPENROUTER_EMBEDDING_MODELS.some((m) => m.id === modelId);

/**
 * Calculate the cost in credits (USD) for an AI call.
 *
 * Pricing resolution order:
 * 1. Live cached pricing (seeded from static data, refreshed from OpenRouter API every 6h)
 * 2. Static model list fallback (compile-time values)
 *
 * Unknown models are rejected: billing them at a guessed price would let a
 * caller run an expensive model at a cheap rate.
 *
 * Prices in openrouter_models.ts are per 1,000,000 tokens.
 * Formula: cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
 */
export function calculateCost(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
): number {
	// 1. Live cache (populated from static data at startup, refreshed from OpenRouter API)
	const cached = getCachedModelPricing(modelId);
	if (cached) {
		return (
			(inputTokens * cached.inputPrice + outputTokens * cached.outputPrice) /
			1_000_000
		);
	}

	// 2. Static fallback — only reached before initModelPricing() completes (very brief window)
	const chatModel = OPENROUTER_AI_MODELS.find((m) => m.id === modelId);
	if (chatModel) {
		return (
			(inputTokens * chatModel.inputPrice +
				outputTokens * chatModel.outputPrice) /
			1_000_000
		);
	}

	const embeddingModel = OPENROUTER_EMBEDDING_MODELS.find(
		(m) => m.id === modelId,
	);
	if (embeddingModel) {
		return (inputTokens * embeddingModel.inputPrice) / 1_000_000;
	}

	throw new ORPCError("BAD_REQUEST", {
		message: `Unknown model: ${modelId}`,
	});
}

/**
 * Worst-case cost of a chat call, used as the credit reservation.
 * `promptTokens` is the tokenized full prompt (system + context + history + query),
 * `maxOutputTokens` the cap sent to the model.
 */
export function estimateChatCost(
	modelId: string,
	promptTokens: number,
	maxOutputTokens: number,
): number {
	return calculateCost(modelId, promptTokens, maxOutputTokens);
}

/**
 * Cost to bill for a finished (or aborted) chat call.
 * When the provider reported no usage, the reservation is charged in full:
 * a successful call always has input tokens, so zero means "unknown".
 */
export function resolveChatCost(input: {
	modelId: string;
	usage: { inputTokens: number; outputTokens: number } | null | undefined;
	reservedAmount: number;
}): { cost: number; usageKnown: boolean } {
	const { modelId, usage, reservedAmount } = input;
	if (!usage || usage.inputTokens + usage.outputTokens <= 0) {
		return { cost: reservedAmount, usageKnown: false };
	}
	return {
		cost: calculateCost(modelId, usage.inputTokens, usage.outputTokens),
		usageKnown: true,
	};
}

// Smallest amount the numeric(18,8) credit columns can hold
export const CREDIT_EPSILON = 1e-8;

export type Settlement =
	| { kind: "refund"; amount: number }
	| { kind: "charge"; amount: number }
	| { kind: "none"; amount: 0 };

/**
 * Difference between what was reserved and what the call really cost.
 * "charge" is collected even when it drives the balance negative.
 */
export function computeSettlement(
	reservedAmount: number,
	actualCost: number,
): Settlement {
	const diff = reservedAmount - actualCost;
	if (diff >= CREDIT_EPSILON) return { kind: "refund", amount: diff };
	if (-diff >= CREDIT_EPSILON) return { kind: "charge", amount: -diff };
	return { kind: "none", amount: 0 };
}
