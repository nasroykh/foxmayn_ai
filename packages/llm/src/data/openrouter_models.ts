// prettier-ignore

export const OPENROUTER_AI_MODELS = [
	{ id: "anthropic/claude-opus-4.5", inputPrice: 5, outputPrice: 25, contextLength: 200000 },
	{ id: "anthropic/claude-haiku-4.5", inputPrice: 1, outputPrice: 5, contextLength: 200000 },
	{ id: "anthropic/claude-sonnet-4.5", inputPrice: 3, outputPrice: 15, contextLength: 1000000 },
	{ id: "google/gemini-3.1-pro-preview", inputPrice: 2, outputPrice: 12, contextLength: 1048576 },
	{ id: "google/gemini-3-flash-preview", inputPrice: 0.5, outputPrice: 3, contextLength: 1048576 },
	{ id: "google/gemini-3-pro-preview", inputPrice: 2, outputPrice: 12, contextLength: 1048576 },
	{ id: "google/gemini-2.5-flash", inputPrice: 0.3, outputPrice: 2.5, contextLength: 1048576 },
	{ id: "google/gemini-2.5-pro", inputPrice: 1.25, outputPrice: 10, contextLength: 1048576 },
	{ id: "google/gemini-2.5-flash-lite-preview-09-2025", inputPrice: 0.1, outputPrice: 0.4, contextLength: 1048576 },
	{ id: "google/gemini-2.5-flash-lite", inputPrice: 0.1, outputPrice: 0.4, contextLength: 1048576 },
	{ id: "google/gemma-3-12b-it", inputPrice: 0.04, outputPrice: 0.13, contextLength: 131072 },
	{ id: "google/gemma-3-27b-it", inputPrice: 0.04, outputPrice: 0.15, contextLength: 128000 },
	{ id: "openai/gpt-5.2-chat", inputPrice: 1.75, outputPrice: 14, contextLength: 128000 },
	{ id: "openai/gpt-5.2", inputPrice: 1.75, outputPrice: 14, contextLength: 400000 },
	{ id: "openai/gpt-5.1", inputPrice: 1.25, outputPrice: 10, contextLength: 400000 },
	{ id: "openai/gpt-5.1-chat", inputPrice: 1.25, outputPrice: 10, contextLength: 128000 },
	{ id: "openai/gpt-5", inputPrice: 1.25, outputPrice: 10, contextLength: 400000 },
	{ id: "openai/gpt-5-mini", inputPrice: 0.25, outputPrice: 2, contextLength: 400000 },
	{ id: "openai/gpt-5-nano", inputPrice: 0.05, outputPrice: 0.4, contextLength: 400000 },
	{ id: "openai/gpt-oss-20b", inputPrice: 0.03, outputPrice: 0.14, contextLength: 131072 },
	{ id: "openai/gpt-oss-120b", inputPrice: 0.039, outputPrice: 0.19, contextLength: 131072 },
	{ id: "x-ai/grok-4.1-fast", inputPrice: 0.2, outputPrice: 0.5, contextLength: 2000000 },
	{ id: "x-ai/grok-4-fast", inputPrice: 0.2, outputPrice: 0.5, contextLength: 2000000 },
	{ id: "deepseek/deepseek-v3.2", inputPrice: 0.25, outputPrice: 0.40, contextLength: 163840 },
	{ id: "deepseek/deepseek-chat-v3.1", inputPrice: 0.15, outputPrice: 0.75, contextLength: 32768 },
	{ id: "moonshotai/kimi-k2.5", inputPrice: 0.45, outputPrice: 2.2, contextLength: 262144 },
	{ id: "moonshotai/kimi-k2-0905", inputPrice: 0.4, outputPrice: 2, contextLength: 131072 },
	{ id: "z-ai/glm-5", inputPrice: 0.95, outputPrice: 2.55, contextLength: 204800 },
	{ id: "z-ai/glm-4.7-flash", inputPrice: 0.06, outputPrice: 0.4, contextLength: 202752 },
	{ id: "z-ai/glm-4.7", inputPrice: 0.3, outputPrice: 1.4, contextLength: 202752 },
	{ id: "minimax/minimax-m2.5", inputPrice: 0.295, outputPrice: 1.2, contextLength: 196608 },
	{ id: "minimax/minimax-m2.1", inputPrice: 0.27, outputPrice: 0.95, contextLength: 196608 },
] as const;

// prettier-ignore

export const OPENROUTER_EMBEDDING_MODELS = [
	{ id: "openai/text-embedding-3-small", dimensions: 1536, inputPrice: 0.02, outputPrice: 0, contextLength: 8192 },
	{ id: "openai/text-embedding-3-large", dimensions: 3072, inputPrice: 0.13, outputPrice: 0, contextLength: 8192 },
	{ id: "google/gemini-embedding-001", dimensions: 3072, inputPrice: 0.15, outputPrice: 0, contextLength: 20000 },
	{ id: "qwen/qwen3-embedding-8b", dimensions: 4096, inputPrice: 0.01, outputPrice: 0, contextLength: 32768 },
	{ id: "qwen/qwen3-embedding-4b", dimensions: 2560, inputPrice: 0.02, outputPrice: 0, contextLength: 32768 },
	{ id: "baai/bge-m3", dimensions: 1024, inputPrice: 0.01, outputPrice: 0, contextLength: 8192 },
] as const;
