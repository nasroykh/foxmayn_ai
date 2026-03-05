import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "@repo/llm/openrouter/models";
import { getCachedModelPricing } from "../services/model-pricing.service";

/**
 * Calculate the cost in credits (USD) for an AI call.
 *
 * Pricing resolution order:
 * 1. Live cached pricing (seeded from static data, refreshed from OpenRouter API every 6h)
 * 2. Static model list fallback (compile-time values)
 * 3. Conservative unknown-model fallback ($1/M input, $2/M output)
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

	// 3. Unknown model — log warning, return a conservative estimate
	console.warn(
		`[Cost] Unknown model "${modelId}" — using fallback pricing $1/M input, $2/M output`,
	);
	return (inputTokens * 1 + outputTokens * 2) / 1_000_000;
}

/**
 * Estimate cost for a chat query based on message length.
 * Rough estimate: 1 token ≈ 4 characters for English text.
 */
export function estimateChatCost(
	modelId: string,
	inputChars: number,
	estimatedOutputTokens = 500,
): number {
	const estimatedInputTokens = Math.ceil(inputChars / 4);
	return calculateCost(modelId, estimatedInputTokens, estimatedOutputTokens);
}
