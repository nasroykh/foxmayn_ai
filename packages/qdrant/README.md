# @repo/qdrant

Helper functions around `@qdrant/js-client-rest`. Everything is in `src/index.ts`.

## Entry points

- `createQdrantClient({ url, apiKey? })`: builds a client. The key defaults to `QDRANT_API_KEY`.
- Collections: `collectionExists`, `createCollection`, `listCollectionNames`, `deleteCollection`, `getCollectionInfo`, `ensureKeywordIndex`.
- Points: `upsertVectors`, `deleteVectors`, `deleteVectorsByFilter`, `getVectorsByIds`, `countVectors`, `scrollVectors`.
- Search: `searchVectors`, `fullTextSearch`, `hybridSearch`.

The API names collections `<QDRANT_COLLECTION_NAME>_<embedding model slug>` (see `apps/api/src/services/qdrant.filter.ts`). This package does not know about that naming.

## Commands

```bash
pnpm --filter @repo/qdrant build
pnpm --filter @repo/qdrant typecheck
pnpm --filter @repo/qdrant lint
```

## Environment

`QDRANT_URL` (required) and `QDRANT_API_KEY` (optional), read from the root `.env`. The Compose Qdrant service enforces the key.
