# @repo/llm

A typed wrapper around the OpenRouter API for Large Language Model (LLM) interactions, including chat completions, streaming, and batch embeddings.

## Features

- **Typed Model Support**: Full TypeScript support for popular OpenRouter models.
- **Chat & Streaming**: Support for both standard and streaming chat completions.
- **RAG Ready**: Efficient batch embedding generation optimized for RAG pipelines.
- **Reasoning Effort**: Support for "reasoning" models with configurable effort settings.
- **Automatic Fallbacks**: Sensible defaults for temperature, max tokens, and models.

## Installation

This package is part of the monorepo. To use it in an app (e.g., `apps/api`):

```json
// apps/api/package.json
{
	"dependencies": {
		"@repo/llm": "workspace:*"
	}
}
```

## Configuration

### Environment Variables

| Variable             | Description                               | Required |
| -------------------- | ----------------------------------------- | -------- |
| `OPENROUTER_API_KEY` | Your OpenRouter API key                   | Yes      |
| `APP_URL`            | Application URL (for OpenRouter rankings) | No       |

## Usage

### 1. Chat Completion

```typescript
import { OpenRouterQuery } from "@repo/llm";

const answer = await OpenRouterQuery(
	{
		model: "google/gemini-2.5-flash-lite",
		temperature: 0.7,
		maxTokens: 1000,
		reasoning: "none",
	},
	[{ role: "user", content: "Hello!" }],
	"You are a helpful assistant.",
	"What is the capital of France?"
);
```

### 2. Streaming Response

```typescript
import { OpenRouterQuery } from "@repo/llm";

const stream = await OpenRouterQuery(
	{
		model: "google/gemini-2.5-flash-lite",
		temperature: 0.7,
		maxTokens: 1000,
		reasoning: "none",
		stream: true,
	},
	[],
	"You are a helpful assistant.",
	"Tell me a long story."
);

for await (const chunk of stream) {
	process.stdout.write(chunk);
}
```

### 3. Batch Embeddings

```typescript
import { OpenRouterEmbed } from "@repo/llm";

const chunks = ["Hello world", "Artificial intelligence is cool"];
const embeddings = await OpenRouterEmbed(
	"openai/text-embedding-3-small",
	chunks
);

console.log(embeddings.length); // 2
console.log(embeddings[0].length); // 1536
```

## Available Models

The package includes pre-defined model IDs for type safety:

- **Chat Models**: `google/gemini-2.5-flash`, `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, etc.
- **Embedding Models**: `openai/text-embedding-3-small`, `google/gemini-embedding-001`, etc.

Models are defined in `src/data/openrouter_models.ts` and can be updated using the provided generation script.

## Scripts

### Generate Model List

Updates the local model list from the OpenRouter API:

```bash
pnpm run models:generate
```

---

_Last Updated: January 2026_
