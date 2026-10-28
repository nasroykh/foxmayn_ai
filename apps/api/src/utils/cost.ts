import { ORPCError } from "@orpc/server";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import {
	getChatModel,
	getModelPricing,
	type ModelPricing,
} from "../services/model-catalog.service";

/** In the current OpenRouter list (or the static fallback before the first fetch). */
export const isKnownChatModel = (modelId: string): boolean =>
	getChatModel(modelId) !== undefined;

export const isKnownEmbeddingModel = (modelId: string): boolean =>
	OPENROUTER_EMBEDDING_MODELS.some((m) => m.id === modelId);

/** Prices for a call: the highest prompt-size tier the input reaches. */
const pricesFor = (
	pricing: ModelPricing,
	inputTokens: number,
): { inputPrice: number; outputPrice: number } => {
	const tier = pricing.tiers
		?.filter((t) => inputTokens >= t.minPromptTokens)
		.at(-1);
	return tier ?? pricing;
};

/**
 * Calculate the cost in credits (USD) for an AI call.
 *
 * Prices come from the model catalog at call time: the OpenRouter list
 * (refreshed daily, last good copy kept in Redis), or the static list in
 * openrouter_models.ts before the first fetch. Prices are per 1,000,000 tokens.
 *
 * Unknown or unpriced models are rejected: billing them at a guessed price (or
 * zero) would let a caller run an expensive model at a cheap rate.
 *
 * Formula: cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
 */
export function calculateCost(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
): number {
	const pricing = getModelPricing(modelId);
	if (!pricing || !(pricing.inputPrice > 0)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Unknown model: ${modelId}`,
		});
	}

	const { inputPrice, outputPrice } = pricesFor(pricing, inputTokens);
	return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
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
