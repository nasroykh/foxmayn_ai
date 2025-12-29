import OpenAI from "openai";
import { type ReasoningEffort } from "openai/resources";
import { env } from "../config/env";

export const OPENROUTER_AI_MODELS = [
	"anthropic/claude-sonnet-4.5",
	"google/gemini-2.5-flash",
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash-lite",
	"google/gemini-2.0-flash-001",
	"google/gemma-3-12b-it",
	"google/gemma-3-27b-it",
	"openai/gpt-5",
	"openai/gpt-5-mini",
	"openai/gpt-5-nano",
	"openai/gpt-oss-20b",
	"openai/gpt-oss-120b",
	"x-ai/grok-4-fast",
	"x-ai/grok-3-mini",
	"meta-llama/llama-4-scout",
	"meta-llama/llama-4-maverick",
	"nousresearch/hermes-4-405b",
	"nousresearch/hermes-4-70b",
	"deepseek/deepseek-chat-v3.1",
	"moonshotai/kimi-k2-0905",
	"z-ai/glm-4.6",
	"z-ai/glm-4.5-air",
] as const;

export const OPENROUTER_EMBEDDING_MODELS = [
	{
		id: "openai/text-embedding-3-small",
		dimensions: 1536,
	},
	{
		id: "openai/text-embedding-3-large",
		dimensions: 3072,
	},
	{ id: "google/gemini-embedding-001", dimensions: 3072 },
	{ id: "qwen/qwen3-embedding-8b", dimensions: 4096 },
	{ id: "qwen/qwen3-embedding-4b", dimensions: 2560 },
	{ id: "baai/bge-m3", dimensions: 1024 },
] as const;

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_AI_MODELS.find(
	(m) => m === "google/gemini-2.5-flash-lite"
);

export const DEFAULT_TEMPERATURE = 1.0;
export const DEFAULT_MAX_TOKENS = 500;
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";

if (!env.OPENROUTER_API_KEY) {
	throw new Error("OPENROUTER_API_KEY is not set");
}

const openai = new OpenAI({
	baseURL: "https://openrouter.ai/api/v1",
	apiKey: env.OPENROUTER_API_KEY,
	defaultHeaders: {
		"HTTP-Referer": env.APP_URL || "https://nascodes.dev", // Optional. Site URL for rankings on openrouter.ai.
		"X-Title": "Nas Portfolio | Software Engineer & AI/LLM Specialist", // Optional. Site title for rankings on openrouter.ai.
	},
});

type AISettings = {
	model: (typeof OPENROUTER_AI_MODELS)[number];
	temperature: number;
	maxTokens: number;
	reasoningEffort: ReasoningEffort;
	stream?: boolean;
};

export const OpenRouterQuery = async (
	settings: AISettings,
	chatHistory?: OpenAI.ChatCompletionMessageParam[],
	systemPrompt?: string,
	prompt?: string
) => {
	try {
		const messages = chatHistory ? [...chatHistory] : [];

		if (systemPrompt && systemPrompt.trim()) {
			messages.unshift({ role: "system", content: systemPrompt });
		}

		if (prompt && prompt.trim()) {
			messages.push({ role: "user", content: prompt });
		} else {
			throw new Error("Prompt is required");
		}

		if (messages.length === 0) {
			throw new Error("No messages provided");
		}

		if (settings.temperature && settings.temperature !== 0) {
			if (settings.temperature < 0 || settings.temperature > 2) {
				throw new Error("Temperature must be between 0 and 2");
			}
		}

		if (settings.maxTokens && settings.maxTokens <= 0) {
			throw new Error("Max tokens must be greater than 0");
		}

		if (settings.stream && settings.stream === true) {
			const stream = await openai.chat.completions.create({
				messages,
				model: settings.model || DEFAULT_OPENROUTER_MODEL,
				temperature: settings.temperature || DEFAULT_TEMPERATURE,
				max_completion_tokens: settings.maxTokens || DEFAULT_MAX_TOKENS,
				reasoning_effort:
					(settings.reasoningEffort as ReasoningEffort) ||
					DEFAULT_REASONING_EFFORT,
				stream: true,
			});

			return stream;
		} else {
			const { choices } = await openai.chat.completions.create({
				messages,
				model: settings.model || DEFAULT_OPENROUTER_MODEL,
				temperature: settings.temperature || DEFAULT_TEMPERATURE,
				max_completion_tokens: settings.maxTokens || DEFAULT_MAX_TOKENS,
				reasoning_effort:
					(settings.reasoningEffort as ReasoningEffort) ||
					DEFAULT_REASONING_EFFORT,
			});

			if (choices.length <= 0) {
				throw new Error("No choices returned from completion");
			}

			if (!choices[0]?.message.content) {
				throw new Error("No message returned from completion");
			}

			return choices[0].message.content;
		}
	} catch (error) {
		console.error(error);
		throw error;
	}
};

export const OpenRouterEmbed = async (
	model: (typeof OPENROUTER_EMBEDDING_MODELS)[number]["id"],
	text: string
) => {
	try {
		let dimensions = OPENROUTER_EMBEDDING_MODELS.find(
			(m) => m.id === model
		)?.dimensions;

		if (!dimensions) {
			throw new Error("Invalid model");
		}

		const embedding = await openai.embeddings.create({
			model,
			input: text,
			dimensions,
			encoding_format: "float",
		});

		if (!embedding?.data?.length) {
			throw new Error("No embedding returned from completion");
		}

		return embedding.data[0].embedding;
	} catch (error) {
		console.error(error);
		throw error;
	}
};

/**
 * Batch embedding - generates embeddings for multiple texts in a single API call
 * MUCH more efficient than calling OpenRouterEmbed in a loop
 *
 * @param model - Embedding model to use
 * @param texts - Array of texts to embed (max ~100 for best performance)
 * @returns Array of embedding vectors in the same order as input texts
 */
export const OpenRouterEmbedBatch = async (
	model: (typeof OPENROUTER_EMBEDDING_MODELS)[number]["id"],
	texts: string[]
): Promise<number[][]> => {
	if (texts.length === 0) {
		return [];
	}

	// Single text - use regular function
	if (texts.length === 1) {
		const embedding = await OpenRouterEmbed(model, texts[0]);
		return [embedding];
	}

	try {
		let dimensions = OPENROUTER_EMBEDDING_MODELS.find(
			(m) => m.id === model
		)?.dimensions;

		if (!dimensions) {
			throw new Error("Invalid model");
		}

		// OpenAI API accepts array of strings for batch embedding
		const response = await openai.embeddings.create({
			model,
			input: texts,
			dimensions,
			encoding_format: "float",
		});

		if (!response?.data?.length) {
			throw new Error("No embeddings returned from batch completion");
		}

		// Response data is sorted by index, but let's be explicit
		// Sort by index to ensure order matches input
		const sorted = response.data.sort((a, b) => a.index - b.index);

		return sorted.map((item) => item.embedding);
	} catch (error) {
		console.error("Batch embedding error:", error);
		throw error;
	}
};
