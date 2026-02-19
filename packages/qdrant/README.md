# @repo/qdrant

A typed wrapper around the Qdrant vector database client for semantic search, full-text search, and vector operations.

## Prerequisites

### 1. Running Qdrant

You need a running Qdrant instance. Options:

**Docker (recommended for local development):**

```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

**Docker Compose:**

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_storage:/qdrant/storage

volumes:
  qdrant_storage:
```

**Qdrant Cloud:**
Sign up at [cloud.qdrant.io](https://cloud.qdrant.io) and get your cluster URL + API key.

---

## Installation

This package is part of the monorepo. To use it in an app (e.g., `apps/api`):

```json
// apps/api/package.json
{
	"dependencies": {
		"@repo/qdrant": "workspace:*"
	}
}
```

Then run:

```bash
pnpm install
```

---

## Configuration

### Environment Variables

| Variable         | Description                | Default     |
| ---------------- | -------------------------- | ----------- |
| `QDRANT_HOST`    | Qdrant server host         | `localhost` |
| `QDRANT_PORT`    | Qdrant server port         | `6333`      |
| `QDRANT_API_KEY` | API key (for Qdrant Cloud) | -           |
| `QDRANT_HTTPS`   | Use HTTPS                  | `false`     |

**Example `.env` for local development:**

```env
QDRANT_HOST=localhost
QDRANT_PORT=6333
```

**Example `.env` for Qdrant Cloud:**

```env
QDRANT_HOST=your-cluster.cloud.qdrant.io
QDRANT_PORT=6333
QDRANT_API_KEY=your-api-key
QDRANT_HTTPS=true
```

---

## Quick Start

### 1. Create a Client

```typescript
import { createQdrantClient } from "@repo/qdrant";

// Uses environment variables automatically
const client = createQdrantClient();

// Or with explicit config
const client = createQdrantClient({
	host: "localhost",
	port: 6333,
});

// Or with URL (for Qdrant Cloud)
const client = createQdrantClient({
	url: "https://your-cluster.cloud.qdrant.io:6333",
	apiKey: "your-api-key",
});
```

### 2. Create a Collection

```typescript
import { createCollection } from "@repo/qdrant";

await createCollection(client, "documents", {
	size: 1536, // OpenAI ada-002 embedding size
	distance: "Cosine", // Similarity metric
	textFields: ["content"], // Fields to enable full-text search
	dateTimeFields: ["createdAt"],
	keywordFields: ["category", "userId"],
});
```

**Vector sizes:**

- `1536` - OpenAI `text-embedding-ada-002`, `text-embedding-3-small`
- `3072` - OpenAI `text-embedding-3-large`

### 3. Insert Vectors

```typescript
import { upsertVectors, Point } from "@repo/qdrant";

interface DocumentPayload {
	content: string;
	category: string;
	userId: string;
	createdAt: string;
}

const points: Point<DocumentPayload>[] = [
	{
		id: "doc-1",
		vector: embedding, // number[] from your embedding model
		payload: {
			content: "This is the document text",
			category: "notes",
			userId: "user-123",
			createdAt: new Date().toISOString(),
		},
	},
];

await upsertVectors(client, "documents", points);
```

### 4. Search

**Semantic Search (vector similarity):**

```typescript
import { searchVectors } from "@repo/qdrant";

const results = await searchVectors(client, "documents", queryEmbedding, {
	limit: 10,
	scoreThreshold: 0.7, // Minimum similarity score
});

for (const result of results) {
	console.log(result.id, result.score, result.payload);
}
```

**Hybrid Search (vector + filters):**

```typescript
import { hybridSearch } from "@repo/qdrant";

const results = await hybridSearch(
	client,
	"documents",
	queryEmbedding,
	{
		must: [
			{ key: "userId", match: { value: "user-123" } },
			{ key: "category", match: { value: "notes" } },
		],
	},
	{ limit: 10, scoreThreshold: 0.5 }
);
```

**Full-Text Search:**

```typescript
import { fullTextSearch } from "@repo/qdrant";

const results = await fullTextSearch(
	client,
	"documents",
	"content", // Field to search
	"search query", // Text to find
	{ limit: 10 }
);
```

---

## API Reference

### Client

| Function                      | Description                     |
| ----------------------------- | ------------------------------- |
| `createQdrantClient(config?)` | Create a Qdrant client instance |

### Collection Operations

| Function                                  | Description                    |
| ----------------------------------------- | ------------------------------ |
| `collectionExists(client, name)`          | Check if collection exists     |
| `createCollection(client, name, options)` | Create collection with indexes |
| `deleteCollection(client, name)`          | Delete a collection            |
| `getCollectionInfo(client, name)`         | Get collection metadata        |

### Vector Operations

| Function                                                | Description                    |
| ------------------------------------------------------- | ------------------------------ |
| `upsertVectors(client, collection, points, options?)`   | Insert or update vectors       |
| `deleteVectors(client, collection, ids)`                | Delete vectors by IDs          |
| `deleteVectorsByFilter(client, collection, filter)`     | Delete vectors matching filter |
| `getVectorsByIds(client, collection, ids, withVector?)` | Retrieve vectors by IDs        |
| `countVectors(client, collection, filter?)`             | Count vectors                  |

### Search Operations

| Function                                                     | Description                      |
| ------------------------------------------------------------ | -------------------------------- |
| `searchVectors(client, collection, query, options?)`         | Semantic similarity search       |
| `scrollVectors(client, collection, options?)`                | Paginated retrieval with filters |
| `fullTextSearch(client, collection, field, text, options?)`  | Full-text search                 |
| `hybridSearch(client, collection, vector, filter, options?)` | Vector + filter search           |

---

## Common Patterns

### Pattern 1: RAG (Retrieval-Augmented Generation)

```typescript
import {
	createQdrantClient,
	createCollection,
	upsertVectors,
	searchVectors,
} from "@repo/qdrant";
import { generateEmbedding } from "./embedding"; // Your embedding function

const client = createQdrantClient();
const COLLECTION = "knowledge-base";

// Setup (run once)
await createCollection(client, COLLECTION, {
	size: 1536,
	textFields: ["content"],
	keywordFields: ["source"],
});

// Index documents
async function indexDocument(id: string, content: string, source: string) {
	const embedding = await generateEmbedding(content);
	await upsertVectors(client, COLLECTION, [
		{ id, vector: embedding, payload: { content, source } },
	]);
}

// Query for RAG
async function retrieveContext(query: string, limit = 5) {
	const queryEmbedding = await generateEmbedding(query);
	const results = await searchVectors(client, COLLECTION, queryEmbedding, {
		limit,
		scoreThreshold: 0.6,
	});
	return results.map((r) => r.payload?.content).join("\n\n");
}
```

### Pattern 2: Multi-Tenant Search

```typescript
// Create collection with tenant isolation
await createCollection(client, "tenant-docs", {
	size: 1536,
	keywordFields: ["tenantId"],
	textFields: ["content"],
});

// Search within tenant
async function searchForTenant(tenantId: string, queryVector: number[]) {
	return hybridSearch(
		client,
		"tenant-docs",
		queryVector,
		{ must: [{ key: "tenantId", match: { value: tenantId } }] },
		{ limit: 10 }
	);
}
```

### Pattern 3: Pagination with Scroll

```typescript
async function getAllDocuments(collection: string) {
	const allPoints = [];
	let offset: string | number | null = null;

	do {
		const { points, nextOffset } = await scrollVectors(client, collection, {
			limit: 100,
			offset: offset ?? undefined,
		});
		allPoints.push(...points);
		offset = nextOffset;
	} while (offset !== null);

	return allPoints;
}
```

### Pattern 4: Batch Cleanup

```typescript
// Delete all vectors for a user
await deleteVectorsByFilter(client, "documents", {
	must: [{ key: "userId", match: { value: "user-to-delete" } }],
});

// Delete old vectors
await deleteVectorsByFilter(client, "documents", {
	must: [
		{
			key: "createdAt",
			range: { lt: "2024-01-01T00:00:00Z" },
		},
	],
});
```

---

## Integration Example: apps/api

```typescript
// apps/api/src/lib/qdrant.ts
import { createQdrantClient } from "@repo/qdrant";

export const qdrant = createQdrantClient();

// apps/api/src/services/search.service.ts
import { qdrant } from "../lib/qdrant";
import {
	createCollection,
	upsertVectors,
	searchVectors,
	hybridSearch,
	Point,
} from "@repo/qdrant";

const COLLECTION = "app-vectors";

interface AppPayload {
	content: string;
	userId: string;
	type: string;
	createdAt: string;
}

export async function initializeCollection() {
	await createCollection(qdrant, COLLECTION, {
		size: 1536,
		textFields: ["content"],
		keywordFields: ["userId", "type"],
		dateTimeFields: ["createdAt"],
	});
}

export async function indexContent(
	id: string,
	content: string,
	embedding: number[],
	userId: string,
	type: string
) {
	const point: Point<AppPayload> = {
		id,
		vector: embedding,
		payload: {
			content,
			userId,
			type,
			createdAt: new Date().toISOString(),
		},
	};
	await upsertVectors(qdrant, COLLECTION, [point]);
}

export async function searchContent(
	userId: string,
	queryEmbedding: number[],
	type?: string
) {
	const filter: any = {
		must: [{ key: "userId", match: { value: userId } }],
	};

	if (type) {
		filter.must.push({ key: "type", match: { value: type } });
	}

	return hybridSearch(qdrant, COLLECTION, queryEmbedding, filter, {
		limit: 10,
		scoreThreshold: 0.5,
	});
}
```

---

## Filter Syntax Reference

```typescript
// Exact match
{ key: "status", match: { value: "active" } }

// Text search (requires text index)
{ key: "content", match: { text: "search terms" } }

// Range (numbers)
{ key: "price", range: { gte: 10, lte: 100 } }

// Range (dates)
{ key: "createdAt", range: { gte: "2024-01-01T00:00:00Z" } }

// Combine with must (AND)
{
  must: [
    { key: "userId", match: { value: "user-1" } },
    { key: "status", match: { value: "active" } },
  ]
}

// Combine with should (OR)
{
  should: [
    { key: "category", match: { value: "A" } },
    { key: "category", match: { value: "B" } },
  ]
}

// Exclude with must_not
{
  must_not: [
    { key: "deleted", match: { value: true } },
  ]
}
```

---

## Types

```typescript
import type {
	QdrantClient,
	Schemas,
	Distance,
	VectorSize,
	QdrantConfig,
	CreateCollectionOptions,
	UpsertOptions,
	SearchOptions,
	ScrollOptions,
	Point,
} from "@repo/qdrant";
```

---

## Troubleshooting

| Issue                        | Solution                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| Connection refused           | Ensure Qdrant is running on the configured host/port              |
| Collection not found         | Create the collection first with `createCollection`               |
| Search returns empty         | Check `scoreThreshold` isn't too high, verify vectors are indexed |
| Full-text search not working | Ensure the field has a text index in `textFields`                 |

---

## Resources

- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Qdrant JS Client](https://github.com/qdrant/js-client-rest)
- [Filtering Guide](https://qdrant.tech/documentation/concepts/filtering/)
- [Indexing Guide](https://qdrant.tech/documentation/concepts/indexing/)
