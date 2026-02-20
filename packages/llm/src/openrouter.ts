import { OpenRouter } from "@openrouter/sdk";
import { Reasoning } from "@openrouter/sdk/esm/models";
import { env } from "./config/env";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "./data/openrouter_models";

if (!env.OPENROUTER_API_KEY) {
	throw new Error("OPENROUTER_API_KEY is not set");
}

const openrouter = new OpenRouter({
	apiKey: env.OPENROUTER_API_KEY,
	xTitle: "Foxmayn AI",
	httpReferer: env.APP_URL || "https://foxmayn.ai", // Optional. Site URL for rankings on openrouter.ai.
});

export type AIModelId = (typeof OPENROUTER_AI_MODELS)[number]["id"];
export type EmbeddingModelId =
	(typeof OPENROUTER_EMBEDDING_MODELS)[number]["id"];

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

export const OpenRouterQuery = async (
	settings: AISettings,
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
) => {
	try {
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

		const chatResponse = openrouter.callModel({
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

		if (!settings.stream) {
			return await chatResponse.getText();
		}

		const stream = chatResponse.getTextStream();

		return stream;
	} catch (error) {
		console.error(error);
		throw error;
	}
};

// /**
//  * Batch embedding - generates embeddings for multiple text chunks in a single API call
//  * MUCH more efficient than calling OpenRouterEmbed in a loop
//  *
//  * @param model - Embedding model to use
//  * @param chunks - Array of text chunks to embed (max ~100 for best performance)
//  * @returns Array of embedding vectors in the same order as input text chunks
//  */
export const OpenRouterEmbed = async (
	model: EmbeddingModelId | (string & {}),
	chunks: string[],
): Promise<number[][]> => {
	if (!chunks.length) throw new Error("Chunks are required");

	try {
		const dimensions = OPENROUTER_EMBEDDING_MODELS.find(
			(m) => m.id === model,
		)?.dimensions;

		if (!dimensions) throw new Error("Invalid model");

		// OpenRouter SDK uses .generate() instead of .create()
		const response = await openrouter.embeddings.generate({
			requestBody: {
				input: chunks,
				model,
				encodingFormat: "float",
				dimensions,
			},
		});

		// Response can be a string or object, validation required
		if (typeof response !== "object" || !response || !("data" in response)) {
			throw new Error("Invalid response from OpenRouter embedding generation");
		}

		if (!response.data?.length) {
			throw new Error("No embeddings returned from batch completion");
		}

		// Response data is sorted by index
		// Sort by index to ensure order matches input
		const sorted = response.data.sort(
			(a, b) => (a.index ?? 0) - (b.index ?? 0),
		);

		return sorted.map((item) => {
			if (typeof item.embedding === "string") {
				throw new Error("Received string embedding but expected float");
			}
			return item.embedding;
		});
	} catch (error) {
		console.error("Batch embedding error:", error);
		throw error;
	}
};
