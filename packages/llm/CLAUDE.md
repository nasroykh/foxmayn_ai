# LLM Package

OpenRouter SDK wrapper for AI model queries and embeddings.

## Key Functions

### `OpenRouterQuery`

Chat completion with streaming support:

```typescript
const response = await OpenRouterQuery(
	{ model: "google/gemini-2.5-flash-lite", temperature: 0.7, maxTokens: 2048, stream: true },
	chatHistory,
	systemPrompt,
	userPrompt
);
```

### `OpenRouterEmbed`

Batch embedding generation:

```typescript
const embeddings = await OpenRouterEmbed("openai/text-embedding-3-small", chunks);
// Returns: number[][] (one vector per chunk)
```

## Models

- `OPENROUTER_AI_MODELS` - Available chat models
- `OPENROUTER_EMBEDDING_MODELS` - Available embedding models with dimensions

## Environment

Requires `OPENROUTER_API_KEY` in `.env`
