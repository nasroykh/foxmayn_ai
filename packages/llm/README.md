# @repo/llm

Thin wrapper over the OpenRouter SDK: chat (plain and streaming), embeddings, and a static model list.

## Entry points

- `src/openrouter.ts`: `OpenRouterQuery` (chat, streaming and non-streaming) and `OpenRouterEmbed`. The client is created on first use and reports a clear error if the key is missing. Requests time out after 180 seconds and retry with backoff.
- `src/data/openrouter_models.ts`: `OPENROUTER_AI_MODELS` and `OPENROUTER_EMBEDDING_MODELS`. Exported as `@repo/llm/openrouter/models`.
  - Embedding models: only these ids are accepted by the API.
  - Chat models: the API accepts any priced model in the live OpenRouter list. This list is only the fallback until the first fetch, when neither OpenRouter nor the Redis copy is available.

## Updating the model list

```bash
pnpm models:generate
```

The script `src/scripts/generate_model_list.ts` fetches current data from OpenRouter for the ids already in the file. It exits with an error and writes nothing if the fetch fails or a model is missing. To add a model, add its id to the file first, then run the script.

## Commands

```bash
pnpm --filter @repo/llm build
pnpm --filter @repo/llm typecheck
pnpm --filter @repo/llm lint
```

## Environment

`OPENROUTER_API_KEY` (needed on first call) and `APP_URL` (sent as the referer), read from the root `.env`.
