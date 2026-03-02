import { OpenRouter } from "@openrouter/sdk";
import { env } from "./config/env";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "./data/openrouter_models";
import type { Reasoning } from "openai/resources";

if (!env.OPENROUTER_API_KEY) {
	throw new Error("OPENROUTER_API_KEY is not set");
}

const openrouter = new OpenRouter({
	apiKey: env.OPENROUTER_API_KEY,
	xTitle: "Foxmayn AI",
	httpReferer: env.APP_URL || "https://foxmayn.ai",
});

export type AIModelId = (typeof OPENROUTER_AI_MODELS)[number]["id"];
export type EmbeddingModelId =
	(typeof OPENROUTER_EMBEDDING_MODELS)[number]["id"];

// ============================================================================
// Usage tracking types
// ============================================================================

export type AIUsage = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
};

export type QueryResultWithUsage = {
	text: string;
	usage: AIUsage;
};

export type StreamQueryResultWithUsage = {
	stream: AsyncIterable<string>;
	getUsage: () => Promise<AIUsage>;
};

export type EmbedResultWithUsage = {
	embeddings: number[][];
	usage: { totalTokens: number };
};

// ============================================================================
// AI Settings
// ============================================================================

type AISettings = {
	model: AIModelId | (string & {});
	temperature: number;
	topP?: number;
	maxTokens: number;
	reasoning: Reasoning["effort"];
	stream?: boolean;
};

const DEFAULT_AI_SETTINGS: AISettings = {
	model: "google/gemini-2.5-flash-lite",
	temperature: 1.0,
	maxTokens: 500,
	reasoning: "none" satisfies Reasoning["effort"],
	topP: 1.0,
} as const;

// ============================================================================
// OpenRouterQuery — returns usage alongside response
// ============================================================================

/**
 * Query an LLM via OpenRouter.
 *
 * - Non-streaming (`stream: false`): returns `QueryResultWithUsage`
 * - Streaming (`stream: true`): returns `StreamQueryResultWithUsage`
 */
export function OpenRouterQuery(
	settings: AISettings & { stream: true },
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
): StreamQueryResultWithUsage;
export function OpenRouterQuery(
	settings: AISettings & { stream?: false | undefined },
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
): Promise<QueryResultWithUsage>;
export function OpenRouterQuery(
	settings: AISettings,
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
): Promise<QueryResultWithUsage> | StreamQueryResultWithUsage {
	const messages = chatHistory && chatHistory.length ? [...chatHistory] : [];

	if (!prompt || !prompt.trim()) throw new Error("Prompt is required");

	if (systemPrompt && systemPrompt.trim()) {
		messages.unshift({ role: "system", content: systemPrompt });
	}

	messages.push({ role: "user", content: prompt });

	if (
		settings.temperature &&
		(settings.temperature < 0 || settings.temperature > 2)
	) {
		throw new Error("Temperature must be between 0 and 2");
	}

	if (settings.maxTokens && settings.maxTokens <= 0) {
		throw new Error("Max tokens must be greater than 0");
	}

	if (settings.topP && (settings.topP < 0 || settings.topP > 1)) {
		throw new Error("Top P must be between 0 and 1");
	}

	const callResult = openrouter.callModel({
		input: messages,
		model: settings.model || DEFAULT_AI_SETTINGS.model,
		temperature: settings.temperature || DEFAULT_AI_SETTINGS.temperature,
		topP: settings.topP || DEFAULT_AI_SETTINGS.topP,
		maxOutputTokens: settings.maxTokens || DEFAULT_AI_SETTINGS.maxTokens,
		reasoning: {
			enabled: settings.reasoning
				? settings.reasoning !== "none"
				: DEFAULT_AI_SETTINGS.reasoning !== "none",
			effort: settings.reasoning || DEFAULT_AI_SETTINGS.reasoning,
		},
	});

	if (settings.stream) {
		// Streaming: return stream + deferred usage getter
		const stream = callResult.getTextStream();

		const getUsage = async (): Promise<AIUsage> => {
			try {
				const response = await callResult.getResponse();
				return {
					inputTokens: response.usage?.inputTokens ?? 0,
					outputTokens: response.usage?.outputTokens ?? 0,
					totalTokens:
						(response.usage?.inputTokens ?? 0) +
						(response.usage?.outputTokens ?? 0),
				};
			} catch (error) {
				console.error(
					"[OpenRouter] Failed to retrieve usage data after stream — token counts will be zero and billing may be inaccurate:",
					error,
				);
				return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
			}
		};

		return { stream, getUsage };
	}

	// Non-streaming: await full response with usage
	return (async (): Promise<QueryResultWithUsage> => {
		try {
			const response = await callResult.getResponse();
			const text = await callResult.getText();

			return {
				text: text || "",
				usage: {
					inputTokens: response.usage?.inputTokens ?? 0,
					outputTokens: response.usage?.outputTokens ?? 0,
					totalTokens:
						(response.usage?.inputTokens ?? 0) +
						(response.usage?.outputTokens ?? 0),
				},
			};
		} catch (error) {
			console.error(error);
			throw error;
		}
	})();
}

// ============================================================================
// OpenRouterEmbed — returns usage alongside embeddings
// ============================================================================

/**
 * Batch embedding with usage tracking.
 *
 * @param model - Embedding model to use
 * @param chunks - Array of text chunks to embed
 * @returns Embeddings array + token usage
 */
export const OpenRouterEmbed = async (
	model: EmbeddingModelId | (string & {}),
	chunks: string[],
): Promise<EmbedResultWithUsage> => {
	if (!chunks.length) throw new Error("Chunks are required");

	try {
		const dimensions = OPENROUTER_EMBEDDING_MODELS.find(
			(m) => m.id === model,
		)?.dimensions;

		if (!dimensions) throw new Error("Invalid model");

		const response = await openrouter.embeddings.generate({
			requestBody: {
				model,
				input: chunks,
				encodingFormat: "float",
				dimensions,
			},
		});

		if (typeof response !== "object" || !response || !("data" in response)) {
			throw new Error("Invalid response from OpenRouter embedding generation");
		}

		if (!response.data?.length) {
			throw new Error("No embeddings returned from batch completion");
		}

		const sorted = response.data.sort(
			(a, b) => (a.index ?? 0) - (b.index ?? 0),
		);

		const embeddings = sorted.map((item) => {
			if (typeof item.embedding === "string") {
				throw new Error("Received string embedding but expected float");
			}
			return item.embedding;
		});

		// Extract usage from response
		const usage = (response as Record<string, unknown>).usage as
			| { prompt_tokens?: number; total_tokens?: number }
			| undefined;

		return {
			embeddings,
			usage: {
				totalTokens: usage?.total_tokens ?? usage?.prompt_tokens ?? 0,
			},
		};
	} catch (error) {
		console.error("Batch embedding error:", error);
		throw error;
	}
};
