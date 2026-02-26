import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "@repo/llm/openrouter/models";

/**
 * Calculate the cost in credits (USD) for an AI call.
 *
 * Model prices in openrouter_models.ts are per 1,000,000 tokens.
 * Formula: cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
 */
export function calculateCost(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
): number {
	// Check chat models
	const chatModel = OPENROUTER_AI_MODELS.find((m) => m.id === modelId);
	if (chatModel) {
		return (
			(inputTokens * chatModel.inputPrice +
				outputTokens * chatModel.outputPrice) /
			1_000_000
		);
	}

	// Check embedding models
	const embeddingModel = OPENROUTER_EMBEDDING_MODELS.find(
		(m) => m.id === modelId,
	);
	if (embeddingModel) {
		return (inputTokens * embeddingModel.inputPrice) / 1_000_000;
	}

	// Unknown model — log warning, return a conservative estimate
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
