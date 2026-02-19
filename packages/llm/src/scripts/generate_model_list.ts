import fs from "fs";
import path from "path";

const TARGET_MODEL_IDS = [
	"anthropic/claude-opus-4.5",
	"anthropic/claude-haiku-4.5",
	"anthropic/claude-sonnet-4.5",
	"google/gemini-3-flash-preview",
	"google/gemini-3-pro-preview",
	"google/gemini-2.5-flash",
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash-lite",
	"google/gemma-3-12b-it",
	"google/gemma-3-27b-it",
	"openai/gpt-5.2-chat",
	"openai/gpt-5.2",
	"openai/gpt-5.1",
	"openai/gpt-5.1-chat",
	"openai/gpt-5",
	"openai/gpt-5-mini",
	"openai/gpt-5-nano",
	"openai/gpt-oss-20b",
	"openai/gpt-oss-120b",
	"x-ai/grok-4.1-fast",
	"x-ai/grok-4-fast",
	"deepseek/deepseek-v3.2",
	"deepseek/deepseek-chat-v3.1",
	"moonshotai/kimi-k2-0905",
	"z-ai/glm-4.7",
	"z-ai/glm-4.6",
	"z-ai/glm-4.5-air",
	"minimax/minimax-m2.1",
	"minimax/minimax-m2",
];

const TARGET_EMBEDDING_MODELS = [
	{ id: "openai/text-embedding-3-small", dimensions: 1536 },
	{ id: "openai/text-embedding-3-large", dimensions: 3072 },
	{ id: "google/gemini-embedding-001", dimensions: 3072 },
	{ id: "qwen/qwen3-embedding-8b", dimensions: 4096 },
	{ id: "qwen/qwen3-embedding-4b", dimensions: 2560 },
	{ id: "baai/bge-m3", dimensions: 1024 },
];

interface OpenRouterModelCost {
	prompt: string;
	completion: string;
}

interface OpenRouterModel {
	id: string;
	pricing: OpenRouterModelCost;
	context_length: number;
}

interface OpenRouterResponse {
	data: OpenRouterModel[];
}

const main = async () => {
	try {
		// Fetch chat models
		const chatResponse = await fetch("https://openrouter.ai/api/v1/models");
		if (!chatResponse.ok) {
			throw new Error(`Chat API call failed: ${chatResponse.statusText}`);
		}
		const chatParsed: OpenRouterResponse =
			(await chatResponse.json()) as OpenRouterResponse;
		const chatModels = chatParsed.data;

		// Fetch embedding models
		// Although OpenRouter docs say /models returns all, a specific endpoint might exist or we can filter.
		// User requested separate calls.
		const embeddingResponse = await fetch(
			"https://openrouter.ai/api/v1/embeddings/models"
		);
		if (!embeddingResponse.ok) {
			throw new Error(
				`Embedding API call failed: ${embeddingResponse.statusText}`
			);
		}
		const embeddingParsed: OpenRouterResponse =
			(await embeddingResponse.json()) as OpenRouterResponse;
		const embeddingModels = embeddingParsed.data;

		const resultModels = TARGET_MODEL_IDS.map((targetId) => {
			const found = chatModels.find((m) => m.id === targetId);
			if (!found) {
				console.warn(
					`// Warning: Model ID '${targetId}' not found in chat data.`
				);
				return {
					id: targetId,
					inputPrice: 0,
					outputPrice: 0,
					contextLength: 0,
				};
			}

			return {
				id: found.id,
				inputPrice: parseFloat(found.pricing.prompt) * 1000000,
				outputPrice: parseFloat(found.pricing.completion) * 1000000,
				contextLength: found.context_length,
			};
		});

		const resultEmbeddingModels = TARGET_EMBEDDING_MODELS.map((target) => {
			const found = embeddingModels.find((m) => m.id === target.id);
			if (!found) {
				console.warn(
					`// Warning: Model ID '${target.id}' not found in embedding data.`
				);
				return {
					...target,
					inputPrice: 0,
					outputPrice: 0,
					contextLength: 0,
				};
			}

			return {
				...target,
				inputPrice: parseFloat(found.pricing.prompt) * 1000000,
				outputPrice: parseFloat(found.pricing.completion) * 1000000,
				contextLength: found.context_length,
			};
		});

		const outputString =
			`export const OPENROUTER_AI_MODELS = [\n` +
			resultModels
				.map(
					(m) =>
						`\t{ id: "${m.id}", inputPrice: ${Number(
							m.inputPrice.toFixed(6)
						)}, outputPrice: ${Number(
							m.outputPrice.toFixed(6)
						)}, contextLength: ${m.contextLength} },`
				)
				.join("\n") +
			`\n] as const;\n\n` +
			`export const OPENROUTER_EMBEDDING_MODELS = [\n` +
			resultEmbeddingModels
				.map(
					(m) =>
						`\t{ id: "${m.id}", dimensions: ${
							m.dimensions
						}, inputPrice: ${Number(
							m.inputPrice.toFixed(6)
						)}, outputPrice: ${Number(
							m.outputPrice.toFixed(6)
						)}, contextLength: ${m.contextLength} },`
				)
				.join("\n") +
			`\n] as const;`;

		const filePath = path.resolve(
			__filename,
			"../../data/openrouter_models.ts"
		);
		fs.writeFileSync(filePath, outputString, "utf-8");
	} catch (error) {
		console.error("Error generating models:", error);
	}
};

main();
