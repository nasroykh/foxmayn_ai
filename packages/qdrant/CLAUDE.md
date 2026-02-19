# Qdrant Package

Vector database client for Qdrant.

## Key Functions

```typescript
import {
	createQdrantClient,
	createCollection,
	upsertVectors,
	searchVectors,
	deleteVectorsByFilter,
} from "@repo/qdrant";
```

### Client Creation

```typescript
const qdrant = createQdrantClient({ url: "http://localhost:6333" });
```

### Collection Management

```typescript
await createCollection(qdrant, "my_collection", {
	size: 1536, // Vector dimensions
	distance: "Cosine",
	keywordFields: ["documentId"],
	textFields: ["content"],
});
```

### Vector Operations

```typescript
// Upsert
await upsertVectors(qdrant, collection, points);

// Search
const results = await searchVectors(qdrant, collection, queryVector, {
  limit: 5,
  scoreThreshold: 0.3,
});

// Delete by filter
await deleteVectorsByFilter(qdrant, collection, { must: [...] });
```

## Environment

Requires `QDRANT_URL` in `.env`
