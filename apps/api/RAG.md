# RAG (Retrieval-Augmented Generation) API Documentation

This document describes the RAG implementation for the Foxmayn API, which enables semantic document search and AI-powered question answering based on indexed content.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Services](#services)
4. [API Routes](#api-routes)
5. [Usage Examples](#usage-examples)
6. [Configuration](#configuration)

---

## Architecture Overview

The RAG system follows a standard retrieval-augmented generation pattern:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Document  │────▶│   Chunking  │────▶│  Embedding  │
│   Upload    │     │   Service   │     │  Generation │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         ▼                         │
              ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
              │  PostgreSQL │           │   Qdrant    │           │  OpenRouter │
              │  (Metadata) │           │  (Vectors)  │           │    (LLM)    │
              └─────────────┘           └─────────────┘           └─────────────┘
                    │                         │                         │
                    └─────────────────────────┼─────────────────────────┘
                                              │
                                              ▼
                                        ┌─────────────┐
                                        │   Query &   │
                                        │   Response  │
                                        └─────────────┘
```

### Components

| Component      | Purpose                                                           |
| -------------- | ----------------------------------------------------------------- |
| **PostgreSQL** | Stores document metadata, chunk records, and conversation history |
| **Qdrant**     | Vector database for semantic similarity search                    |
| **OpenRouter** | LLM provider for embeddings and text generation                   |

---

## Database Schema

Located in `packages/db/src/models/rag/`

### Tables

#### `document`

Stores document metadata and content.

| Column       | Type      | Description                                  |
| ------------ | --------- | -------------------------------------------- |
| `id`         | text      | Primary key (nanoid)                         |
| `title`      | text      | Document title                               |
| `content`    | text      | Full document content                        |
| `source`     | text      | Optional source URL or identifier            |
| `metadata`   | jsonb     | Custom metadata object                       |
| `status`     | enum      | `pending`, `processing`, `indexed`, `failed` |
| `chunkCount` | integer   | Number of chunks created                     |
| `createdAt`  | timestamp | Creation timestamp                           |
| `updatedAt`  | timestamp | Last update timestamp                        |

#### `document_chunk`

Stores chunked content with vector references.

| Column          | Type      | Description                         |
| --------------- | --------- | ----------------------------------- |
| `id`            | text      | Primary key (nanoid)                |
| `documentId`    | text      | Foreign key to document             |
| `content`       | text      | Chunk content                       |
| `chunkIndex`    | integer   | Position in document                |
| `tokenCount`    | integer   | Estimated token count               |
| `qdrantPointId` | text      | Reference to Qdrant vector          |
| `metadata`      | jsonb     | Chunk metadata (startChar, endChar) |
| `createdAt`     | timestamp | Creation timestamp                  |
| `updatedAt`     | timestamp | Last update timestamp               |

#### `conversation`

Stores chat conversation sessions.

| Column      | Type      | Description           |
| ----------- | --------- | --------------------- |
| `id`        | text      | Primary key           |
| `title`     | text      | Conversation title    |
| `metadata`  | jsonb     | Custom metadata       |
| `createdAt` | timestamp | Creation timestamp    |
| `updatedAt` | timestamp | Last update timestamp |

#### `message`

Stores individual messages in conversations.

| Column           | Type      | Description                   |
| ---------------- | --------- | ----------------------------- |
| `id`             | text      | Primary key                   |
| `conversationId` | text      | Foreign key to conversation   |
| `role`           | enum      | `user`, `assistant`, `system` |
| `content`        | text      | Message content               |
| `tokenCount`     | integer   | Token count                   |
| `metadata`       | jsonb     | Custom metadata               |
| `createdAt`      | timestamp | Creation timestamp            |
| `updatedAt`      | timestamp | Last update timestamp         |

---

## Services

Located in `apps/api/src/services/`

### Chunking Service (`chunking.service.ts`)

Handles text splitting using recursive character separation.

#### Functions

| Function                                       | Description                                                |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `chunkText(text, options)`                     | Splits text into chunks with configurable size and overlap |
| `calculateTokens(text)`                        | Calculates token count                                     |
| `addContextualPrefix(chunks, title, summary?)` | Adds document context to chunks                            |

#### Chunk Options

```typescript
interface ChunkOptions {
	chunkSize?: number; // Target tokens per chunk (default: 500)
	chunkOverlap?: number; // Overlap tokens between chunks (default: 50)
	separators?: string[]; // Custom separators for splitting
}
```

### RAG Service (`rag.service.ts`)

Main RAG pipeline implementation.

#### Functions

| Function                         | Description                            |
| -------------------------------- | -------------------------------------- |
| `indexDocument(options)`         | Indexes a document into the RAG system |
| `searchChunks(query, options)`   | Semantic search for relevant chunks    |
| `queryRAG(query, options)`       | Full RAG query with LLM generation     |
| `queryRAGStream(query, options)` | Streaming RAG query (SSE)              |
| `deleteDocument(documentId)`     | Removes document from both stores      |
| `getDocument(documentId)`        | Retrieves document by ID               |
| `listDocuments(limit, offset)`   | Lists documents with pagination        |

#### Index Document Flow

1. Create document record in PostgreSQL with `processing` status
2. Split content into chunks using recursive character splitting
3. Generate embeddings for each chunk via OpenRouter
4. Store chunk records in PostgreSQL
5. Upsert vectors into Qdrant with payload metadata
6. Update document status to `indexed`

#### Query Flow

1. Generate embedding for the query
2. Search Qdrant for similar vectors
3. Build context from retrieved chunks
4. Generate answer using LLM with context
5. Return answer with source references

---

## API Routes

Base path: `/api`

### Document Routes

#### `POST /api/documents`

Create and index a new document.

**Request Body:**

```json
{
	"title": "Document Title",
	"content": "Full document content...",
	"source": "https://example.com/doc",
	"metadata": {
		"author": "John Doe",
		"category": "technical"
	}
}
```

**Response (201):**

```json
{
	"id": "abc123xyz",
	"message": "Document indexed successfully"
}
```

---

#### `GET /api/documents`

List all documents with pagination.

**Query Parameters:**

| Parameter | Type   | Default | Description               |
| --------- | ------ | ------- | ------------------------- |
| `limit`   | number | 20      | Results per page (1-100)  |
| `offset`  | number | 0       | Number of results to skip |

**Response (200):**

```json
{
	"documents": [
		{
			"id": "abc123xyz",
			"title": "Document Title",
			"source": "https://example.com/doc",
			"status": "indexed",
			"chunkCount": 5,
			"createdAt": "2025-12-12T10:00:00.000Z",
			"updatedAt": "2025-12-12T10:00:00.000Z"
		}
	],
	"total": 1
}
```

---

#### `GET /api/documents/:id`

Get a specific document by ID.

**Response (200):**

```json
{
	"id": "abc123xyz",
	"title": "Document Title",
	"source": "https://example.com/doc",
	"status": "indexed",
	"chunkCount": 5,
	"metadata": {
		"author": "John Doe"
	},
	"createdAt": "2025-12-12T10:00:00.000Z",
	"updatedAt": "2025-12-12T10:00:00.000Z"
}
```

**Response (404):**

```json
{
	"error": "Document not found"
}
```

---

#### `DELETE /api/documents/:id`

Delete a document and all its associated data.

**Response (200):**

```json
{
	"message": "Document deleted successfully"
}
```

**Response (404):**

```json
{
	"error": "Document not found"
}
```

---

### Chat Routes

#### `POST /api/chat/query`

Query the RAG system (non-streaming).

**Request Body:**

```json
{
	"query": "What is the main topic of the document?",
	"options": {
		"limit": 5,
		"scoreThreshold": 0.7,
		"documentId": "abc123xyz",
		"source": "https://example.com"
	}
}
```

| Option           | Type   | Default | Description                    |
| ---------------- | ------ | ------- | ------------------------------ |
| `limit`          | number | 5       | Max chunks to retrieve (1-20)  |
| `scoreThreshold` | number | 0.7     | Minimum similarity score (0-1) |
| `documentId`     | string | -       | Filter by specific document    |
| `source`         | string | -       | Filter by source               |

**Response (200):**

```json
{
	"answer": "Based on the context, the main topic is [1] artificial intelligence and its applications in healthcare...",
	"sources": [
		{
			"documentId": "abc123xyz",
			"chunkId": "chunk456",
			"content": "Artificial intelligence has revolutionized...",
			"score": 0.92
		}
	]
}
```

---

#### `POST /api/chat/search`

Search for relevant chunks without LLM generation.

**Request Body:**

```json
{
	"query": "artificial intelligence",
	"options": {
		"limit": 10,
		"scoreThreshold": 0.5
	}
}
```

**Response (200):**

```json
{
	"results": [
		{
			"documentId": "abc123xyz",
			"chunkId": "chunk456",
			"content": "Artificial intelligence has revolutionized...",
			"score": 0.92
		}
	]
}
```

---

#### `POST /api/chat/query/stream`

Query the RAG system with Server-Sent Events (SSE) streaming.

**Request Body:**

```json
{
	"query": "Explain the key concepts",
	"options": {
		"limit": 5
	}
}
```

**Response (SSE Stream):**

```
event: sources
data: [{"documentId":"abc123","chunkId":"chunk1","content":"...","score":0.9}]

event: token
data: Based

event: token
data:  on

event: token
data:  the

event: token
data:  context

event: done
data:
```

**Event Types:**

| Event     | Description                           |
| --------- | ------------------------------------- |
| `sources` | JSON array of retrieved source chunks |
| `token`   | Individual token from LLM response    |
| `done`    | Indicates stream completion           |
| `error`   | Error message if something fails      |

---

## Usage Examples

### cURL Examples

**Index a document:**

```bash
curl -X POST http://localhost:33450/api/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "AI in Healthcare",
    "content": "Artificial intelligence is transforming healthcare by enabling faster diagnosis, personalized treatment plans, and predictive analytics...",
    "source": "internal-docs",
    "metadata": {"category": "technology"}
  }'
```

**Query the RAG system:**

```bash
curl -X POST http://localhost:33450/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How is AI used in healthcare?",
    "options": {"limit": 3}
  }'
```

**Stream a query response:**

```bash
curl -X POST http://localhost:33450/api/chat/query/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"query": "Summarize the document"}'
```

**List documents:**

```bash
curl "http://localhost:33450/api/documents?limit=10&offset=0"
```

**Delete a document:**

```bash
curl -X DELETE http://localhost:33450/api/documents/abc123xyz
```

### JavaScript/TypeScript Client Example

```typescript
// Index a document
const indexResponse = await fetch("/api/documents", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		title: "My Document",
		content: "Document content here...",
	}),
});
const { id } = await indexResponse.json();

// Query with streaming
const response = await fetch("/api/chat/query/stream", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ query: "What is this about?" }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
	const { done, value } = await reader!.read();
	if (done) break;

	const text = decoder.decode(value);
	const lines = text.split("\n");

	for (const line of lines) {
		if (line.startsWith("event: ")) {
			const event = line.slice(7);
			// Handle event type
		} else if (line.startsWith("data: ")) {
			const data = line.slice(6);
			if (event === "token") {
				process.stdout.write(data);
			}
		}
	}
}
```

---

## Configuration

### Environment Variables

| Variable                 | Description                 | Default      |
| ------------------------ | --------------------------- | ------------ |
| `QDRANT_HOST`            | Qdrant server host          | `localhost`  |
| `QDRANT_PORT`            | Qdrant server port          | `6333`       |
| `QDRANT_API_KEY`         | Qdrant API key (optional)   | -            |
| `QDRANT_COLLECTION_NAME` | Collection name for vectors | `documents`  |
| `OPENROUTER_API_KEY`     | OpenRouter API key          | **Required** |

### Database Migrations

After adding the RAG schema, run migrations:

```bash
pnpm -F @repo/db db:push
```

### Vector Configuration

- **Vector Size:** 1536 (text-embedding-3-small)
- **Distance Metric:** Cosine similarity
- **Indexed Fields:** `documentId`, `source`, `content`

---

## Error Handling

All endpoints return consistent error responses:

```json
{
	"error": "Error message here"
}
```

Common HTTP status codes:

| Code | Description                    |
| ---- | ------------------------------ |
| 200  | Success                        |
| 201  | Created                        |
| 400  | Bad Request (validation error) |
| 404  | Not Found                      |
| 500  | Internal Server Error          |

---

_Last Updated: December 2025_
