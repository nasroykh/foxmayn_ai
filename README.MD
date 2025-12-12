# Production-Ready Type-Safe Fastify RAG API Implementation Guide

> **Purpose**: This document provides complete, step-by-step instructions for an LLM to implement a production-ready, type-safe Fastify API that integrates PostgreSQL, Qdrant vector database, and OpenRouter (via OpenAI SDK) for RAG applications.

---

## Table of Contents

1. [Project Setup & Dependencies](#1-project-setup--dependencies)
2. [TypeScript Configuration](#2-typescript-configuration)
3. [Environment Configuration](#3-environment-configuration)
4. [Fastify Server with TypeBox Type Provider](#4-fastify-server-with-typebox-type-provider)
5. [PostgreSQL with Drizzle ORM](#5-postgresql-with-drizzle-orm)
6. [Qdrant Vector Database Integration](#6-qdrant-vector-database-integration)
7. [OpenRouter via OpenAI SDK](#7-openrouter-via-openai-sdk)
8. [RAG Pipeline Implementation](#8-rag-pipeline-implementation)
9. [Streaming Responses (SSE)](#9-streaming-responses-sse)
10. [Error Handling & Validation](#10-error-handling--validation)
11. [Production Considerations](#11-production-considerations)
12. [Complete File Structure](#12-complete-file-structure)

---

## 1. Project Setup & Dependencies

### Initialize Project

```bash
mkdir fastify-rag-api
cd fastify-rag-api
pnpm init -y
```

### Install Dependencies

```bash
# Core dependencies
pnpm add fastify @fastify/cors @fastify/helmet @fastify/rate-limit

# Type provider and validation
pnpm add @fastify/type-provider-typebox @sinclair/typebox

# SSE for streaming
pnpm add @fastify/sse

# Database - Drizzle ORM with PostgreSQL
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit

# Vector database - Qdrant
pnpm add @qdrant/js-client-rest

# LLM - OpenAI SDK (for OpenRouter)
pnpm add openai

# Environment and utilities
pnpm add dotenv zod pino pino-pretty uuid
pnpm add -D @types/uuid

# Development dependencies
pnpm add -D typescript @types/node tsx
```

### Package.json Scripts

```json
{
	"type": "module",
	"scripts": {
		"dev": "tsx watch src/server.ts",
		"build": "tsc",
		"start": "node dist/server.js",
		"db:generate": "drizzle-kit generate",
		"db:migrate": "drizzle-kit migrate",
		"db:push": "drizzle-kit push",
		"db:studio": "drizzle-kit studio"
	}
}
```

---

## 2. TypeScript Configuration

### tsconfig.json

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"lib": ["ES2022"],
		"outDir": "./dist",
		"rootDir": "./src",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"declaration": true,
		"declarationMap": true,
		"sourceMap": true,
		"noImplicitAny": true,
		"strictNullChecks": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"noImplicitReturns": true,
		"noFallthroughCasesInSwitch": true,
		"allowSyntheticDefaultImports": true,
		"types": ["node"]
	},
	"include": ["src/**/*"],
	"exclude": ["node_modules", "dist"]
}
```

---

## 3. Environment Configuration

### .env file

```env
# Server
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/rag_db

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your-qdrant-api-key  # Optional for local, required for cloud
QDRANT_COLLECTION_NAME=documents

# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-your-api-key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_DEFAULT_MODEL=anthropic/claude-sonnet-4-20250514
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small

# App info (for OpenRouter rankings)
APP_URL=https://your-app.com
APP_NAME=Your RAG App
```

### src/config/env.ts

```typescript
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().default(3000),
	HOST: z.string().default("0.0.0.0"),

	// PostgreSQL
	DATABASE_URL: z.string().url(),

	// Qdrant
	QDRANT_URL: z.string().url(),
	QDRANT_API_KEY: z.string().optional(),
	QDRANT_COLLECTION_NAME: z.string().default("documents"),

	// OpenRouter
	OPENROUTER_API_KEY: z.string().startsWith("sk-or-"),
	OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
	OPENROUTER_DEFAULT_MODEL: z
		.string()
		.default("anthropic/claude-sonnet-4-20250514"),
	OPENROUTER_EMBEDDING_MODEL: z
		.string()
		.default("openai/text-embedding-3-small"),

	// App info
	APP_URL: z.string().url().optional(),
	APP_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parseEnv = (): Env => {
	const parsed = envSchema.safeParse(process.env);

	if (!parsed.success) {
		console.error("❌ Invalid environment variables:");
		console.error(parsed.error.flatten().fieldErrors);
		process.exit(1);
	}

	return parsed.data;
};

export const env = parseEnv();
```

---

## 4. Fastify Server with TypeBox Type Provider

### src/server.ts

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifySSE from "@fastify/sse";
import {
	TypeBoxTypeProvider,
	TypeBoxValidatorCompiler,
} from "@fastify/type-provider-typebox";
import { env } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

const buildServer = async () => {
	const fastify = Fastify({
		logger: {
			level: env.NODE_ENV === "production" ? "info" : "debug",
			transport:
				env.NODE_ENV === "development"
					? { target: "pino-pretty", options: { colorize: true } }
					: undefined,
		},
		ajv: {
			customOptions: {
				allErrors: true,
				removeAdditional: "all",
				coerceTypes: true,
			},
		},
	})
		.setValidatorCompiler(TypeBoxValidatorCompiler)
		.withTypeProvider<TypeBoxTypeProvider>();

	// Register plugins
	await fastify.register(cors, {
		origin:
			env.NODE_ENV === "production" ? [env.APP_URL].filter(Boolean) : true,
		credentials: true,
	});

	await fastify.register(helmet, {
		contentSecurityPolicy: env.NODE_ENV === "production",
	});

	await fastify.register(rateLimit, {
		max: 100,
		timeWindow: "1 minute",
	});

	// Register SSE plugin
	await fastify.register(fastifySSE);

	// Set error handler
	fastify.setErrorHandler(errorHandler);

	// Register routes
	await registerRoutes(fastify);

	return fastify;
};

const start = async () => {
	const server = await buildServer();

	try {
		await server.listen({ port: env.PORT, host: env.HOST });
		console.log(`🚀 Server running at http://${env.HOST}:${env.PORT}`);
	} catch (err) {
		server.log.error(err);
		process.exit(1);
	}
};

start();

export { buildServer };
```

### src/types/fastify.ts

```typescript
import type {
	FastifyInstance,
	FastifyBaseLogger,
	RawReplyDefaultExpression,
	RawRequestDefaultExpression,
	RawServerDefault,
} from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

export type FastifyTypebox = FastifyInstance<
	RawServerDefault,
	RawRequestDefaultExpression<RawServerDefault>,
	RawReplyDefaultExpression<RawServerDefault>,
	FastifyBaseLogger,
	TypeBoxTypeProvider
>;
```

---

## 5. PostgreSQL with Drizzle ORM

### drizzle.config.ts

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
});
```

### src/db/schema.ts

```typescript
import {
	pgTable,
	text,
	timestamp,
	uuid,
	integer,
	jsonb,
	pgEnum,
	varchar,
	boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const documentStatusEnum = pgEnum("document_status", [
	"pending",
	"processing",
	"indexed",
	"failed",
]);

// Timestamps helper
const timestamps = {
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.notNull()
		.$onUpdateFn(() => new Date()),
};

// Documents table - stores document metadata
export const documents = pgTable("documents", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: varchar("title", { length: 500 }).notNull(),
	content: text("content").notNull(),
	source: varchar("source", { length: 1000 }),
	metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
	status: documentStatusEnum("status").default("pending").notNull(),
	chunkCount: integer("chunk_count").default(0),
	...timestamps,
});

// Document chunks table - stores chunked content with vector references
export const documentChunks = pgTable("document_chunks", {
	id: uuid("id").primaryKey().defaultRandom(),
	documentId: uuid("document_id")
		.references(() => documents.id, { onDelete: "cascade" })
		.notNull(),
	content: text("content").notNull(),
	chunkIndex: integer("chunk_index").notNull(),
	tokenCount: integer("token_count"),
	qdrantPointId: uuid("qdrant_point_id"), // Reference to Qdrant vector
	metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
	...timestamps,
});

// Conversations table - stores chat history
export const conversations = pgTable("conversations", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: varchar("title", { length: 500 }),
	metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
	...timestamps,
});

// Messages table - stores individual messages
export const messages = pgTable("messages", {
	id: uuid("id").primaryKey().defaultRandom(),
	conversationId: uuid("conversation_id")
		.references(() => conversations.id, { onDelete: "cascade" })
		.notNull(),
	role: varchar("role", { length: 50 }).notNull(), // 'user' | 'assistant' | 'system'
	content: text("content").notNull(),
	tokenCount: integer("token_count"),
	metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
	...timestamps,
});

// Relations
export const documentsRelations = relations(documents, ({ many }) => ({
	chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
	document: one(documents, {
		fields: [documentChunks.documentId],
		references: [documents.id],
	}),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
	messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id],
	}),
}));

// Types
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
```

### src/db/index.ts

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

// Connection for queries
const queryClient = postgres(env.DATABASE_URL, {
	max: 10,
	idle_timeout: 20,
	connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

// Graceful shutdown
process.on("SIGINT", async () => {
	await queryClient.end();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await queryClient.end();
	process.exit(0);
});
```

---

## 6. Qdrant Vector Database Integration

### src/services/qdrant.service.ts

```typescript
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";
import { v4 as uuidv4 } from "uuid";

// Initialize Qdrant client
const qdrantConfig: ConstructorParameters<typeof QdrantClient>[0] = {
	url: env.QDRANT_URL,
};

if (env.QDRANT_API_KEY) {
	qdrantConfig.apiKey = env.QDRANT_API_KEY;
}

export const qdrantClient = new QdrantClient(qdrantConfig);

// Collection configuration
const VECTOR_SIZE = 1536; // text-embedding-3-small dimension
const COLLECTION_NAME = env.QDRANT_COLLECTION_NAME;

export interface VectorPayload {
	documentId: string;
	chunkId: string;
	content: string;
	chunkIndex: number;
	source?: string;
	metadata?: Record<string, unknown>;
}

export interface SearchResult {
	id: string;
	score: number;
	payload: VectorPayload;
}

export const qdrantService = {
	/**
	 * Initialize collection if it doesn't exist
	 */
	async initializeCollection(): Promise<void> {
		const collections = await qdrantClient.getCollections();
		const exists = collections.collections.some(
			(c) => c.name === COLLECTION_NAME
		);

		if (!exists) {
			await qdrantClient.createCollection(COLLECTION_NAME, {
				vectors: {
					// Dense vector for semantic search
					dense: {
						size: VECTOR_SIZE,
						distance: "Cosine",
					},
				},
				// Optional: Enable sparse vectors for hybrid search
				sparse_vectors: {
					sparse: {},
				},
				// Optimizations
				optimizers_config: {
					default_segment_number: 2,
					memmap_threshold: 20000,
				},
				// Quantization for memory efficiency (optional)
				quantization_config: {
					scalar: {
						type: "int8",
						quantile: 0.99,
						always_ram: true,
					},
				},
			});

			// Create payload indexes for filtering
			await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
				field_name: "documentId",
				field_schema: "keyword",
			});

			await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
				field_name: "source",
				field_schema: "keyword",
			});

			console.log(`✅ Created Qdrant collection: ${COLLECTION_NAME}`);
		}
	},

	/**
	 * Upsert vectors into collection
	 */
	async upsertVectors(
		vectors: Array<{
			id: string;
			embedding: number[];
			payload: VectorPayload;
		}>
	): Promise<void> {
		const points = vectors.map((v) => ({
			id: v.id,
			vector: {
				dense: v.embedding,
			},
			payload: v.payload,
		}));

		await qdrantClient.upsert(COLLECTION_NAME, {
			wait: true,
			points,
		});
	},

	/**
	 * Search for similar vectors
	 */
	async search(
		embedding: number[],
		options: {
			limit?: number;
			scoreThreshold?: number;
			filter?: {
				documentId?: string;
				source?: string;
			};
		} = {}
	): Promise<SearchResult[]> {
		const { limit = 10, scoreThreshold = 0.7, filter } = options;

		// Build filter conditions
		const filterConditions: Array<{
			key: string;
			match: { value: string };
		}> = [];

		if (filter?.documentId) {
			filterConditions.push({
				key: "documentId",
				match: { value: filter.documentId },
			});
		}

		if (filter?.source) {
			filterConditions.push({
				key: "source",
				match: { value: filter.source },
			});
		}

		const searchResult = await qdrantClient.search(COLLECTION_NAME, {
			vector: {
				name: "dense",
				vector: embedding,
			},
			limit,
			score_threshold: scoreThreshold,
			filter:
				filterConditions.length > 0 ? { must: filterConditions } : undefined,
			with_payload: true,
		});

		return searchResult.map((result) => ({
			id: result.id as string,
			score: result.score,
			payload: result.payload as VectorPayload,
		}));
	},

	/**
	 * Hybrid search combining dense and sparse vectors
	 */
	async hybridSearch(
		denseEmbedding: number[],
		sparseVector: { indices: number[]; values: number[] },
		options: {
			limit?: number;
			filter?: {
				documentId?: string;
				source?: string;
			};
		} = {}
	): Promise<SearchResult[]> {
		const { limit = 10, filter } = options;

		// Build filter conditions
		const filterConditions: Array<{
			key: string;
			match: { value: string };
		}> = [];

		if (filter?.documentId) {
			filterConditions.push({
				key: "documentId",
				match: { value: filter.documentId },
			});
		}

		const queryFilter =
			filterConditions.length > 0 ? { must: filterConditions } : undefined;

		// Use Qdrant's Query API for hybrid search with RRF fusion
		const results = await qdrantClient.query(COLLECTION_NAME, {
			prefetch: [
				{
					query: {
						name: "dense",
						vector: denseEmbedding,
					},
					limit: 20,
					filter: queryFilter,
				},
				{
					query: {
						name: "sparse",
						vector: sparseVector,
					},
					limit: 20,
					filter: queryFilter,
				},
			],
			query: {
				fusion: "rrf", // Reciprocal Rank Fusion
			},
			limit,
			with_payload: true,
		});

		return results.points.map((result) => ({
			id: result.id as string,
			score: result.score,
			payload: result.payload as VectorPayload,
		}));
	},

	/**
	 * Delete vectors by document ID
	 */
	async deleteByDocumentId(documentId: string): Promise<void> {
		await qdrantClient.delete(COLLECTION_NAME, {
			wait: true,
			filter: {
				must: [
					{
						key: "documentId",
						match: { value: documentId },
					},
				],
			},
		});
	},

	/**
	 * Delete specific vectors by IDs
	 */
	async deleteByIds(ids: string[]): Promise<void> {
		await qdrantClient.delete(COLLECTION_NAME, {
			wait: true,
			points: ids,
		});
	},

	/**
	 * Get collection info
	 */
	async getCollectionInfo() {
		return qdrantClient.getCollection(COLLECTION_NAME);
	},
};
```

---

## 7. OpenRouter via OpenAI SDK

### src/services/llm.service.ts

```typescript
import OpenAI from "openai";
import { env } from "../config/env.js";

// Initialize OpenAI client pointing to OpenRouter
export const openRouterClient = new OpenAI({
	baseURL: env.OPENROUTER_BASE_URL,
	apiKey: env.OPENROUTER_API_KEY,
	defaultHeaders: {
		"HTTP-Referer": env.APP_URL || "",
		"X-Title": env.APP_NAME || "RAG API",
	},
});

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface CompletionOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	stream?: boolean;
}

export interface EmbeddingResult {
	embedding: number[];
	tokenCount: number;
}

export const llmService = {
	/**
	 * Generate embeddings for text
	 */
	async generateEmbedding(text: string): Promise<EmbeddingResult> {
		const response = await openRouterClient.embeddings.create({
			model: env.OPENROUTER_EMBEDDING_MODEL,
			input: text,
		});

		return {
			embedding: response.data[0].embedding,
			tokenCount: response.usage?.total_tokens || 0,
		};
	},

	/**
	 * Generate embeddings for multiple texts (batch)
	 */
	async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
		const response = await openRouterClient.embeddings.create({
			model: env.OPENROUTER_EMBEDDING_MODEL,
			input: texts,
		});

		return response.data.map((item, index) => ({
			embedding: item.embedding,
			tokenCount: Math.floor(
				(response.usage?.total_tokens || 0) / texts.length
			),
		}));
	},

	/**
	 * Generate chat completion (non-streaming)
	 */
	async generateCompletion(
		messages: ChatMessage[],
		options: CompletionOptions = {}
	): Promise<string> {
		const {
			model = env.OPENROUTER_DEFAULT_MODEL,
			maxTokens = 2048,
			temperature = 0,
		} = options;

		const response = await openRouterClient.chat.completions.create({
			model,
			messages,
			max_tokens: maxTokens,
			temperature,
			stream: false,
		});

		return response.choices[0]?.message?.content || "";
	},

	/**
	 * Generate streaming chat completion
	 * Returns an async iterator
	 */
	async *generateStreamingCompletion(
		messages: ChatMessage[],
		options: CompletionOptions = {}
	): AsyncGenerator<string, void, unknown> {
		const {
			model = env.OPENROUTER_DEFAULT_MODEL,
			maxTokens = 2048,
			temperature = 0,
		} = options;

		const stream = await openRouterClient.chat.completions.create({
			model,
			messages,
			max_tokens: maxTokens,
			temperature,
			stream: true,
		});

		for await (const chunk of stream) {
			const content = chunk.choices[0]?.delta?.content;
			if (content) {
				yield content;
			}
		}
	},

	/**
	 * Generate completion with context (RAG)
	 */
	async generateRAGCompletion(
		query: string,
		context: string[],
		options: CompletionOptions = {}
	): Promise<string> {
		const systemPrompt = `You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information to answer the question, say so clearly. Do not make up information.

Context:
${context.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}

Instructions:
- Use only the information from the context above
- Cite sources using [number] notation when referencing specific context
- Be concise and accurate
- If uncertain, express your uncertainty`;

		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: query },
		];

		return this.generateCompletion(messages, { ...options, temperature: 0 });
	},

	/**
	 * Generate streaming RAG completion
	 */
	async *generateStreamingRAGCompletion(
		query: string,
		context: string[],
		options: CompletionOptions = {}
	): AsyncGenerator<string, void, unknown> {
		const systemPrompt = `You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information to answer the question, say so clearly. Do not make up information.

Context:
${context.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}

Instructions:
- Use only the information from the context above
- Cite sources using [number] notation when referencing specific context
- Be concise and accurate
- If uncertain, express your uncertainty`;

		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: query },
		];

		yield* this.generateStreamingCompletion(messages, {
			...options,
			temperature: 0,
		});
	},
};
```

---

## 8. RAG Pipeline Implementation

### src/services/chunking.service.ts

```typescript
/**
 * Text chunking service using recursive character splitting
 * Recommended: 400-512 tokens with 10-20% overlap
 */

export interface ChunkOptions {
	chunkSize?: number;
	chunkOverlap?: number;
	separators?: string[];
}

export interface Chunk {
	content: string;
	index: number;
	startChar: number;
	endChar: number;
}

const DEFAULT_SEPARATORS = [
	"\n\n",
	"\n",
	". ",
	"! ",
	"? ",
	"; ",
	", ",
	" ",
	"",
];

export const chunkingService = {
	/**
	 * Estimate token count (rough approximation: ~4 chars per token for English)
	 */
	estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	},

	/**
	 * Split text into chunks using recursive character splitting
	 */
	chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
		const {
			chunkSize = 500, // ~2000 characters
			chunkOverlap = 50, // ~200 characters overlap
			separators = DEFAULT_SEPARATORS,
		} = options;

		const targetLength = chunkSize * 4; // Convert tokens to approximate chars
		const overlapLength = chunkOverlap * 4;

		const chunks: Chunk[] = [];
		let currentIndex = 0;

		const splitRecursively = (
			text: string,
			separatorIndex: number
		): string[] => {
			if (text.length <= targetLength) {
				return text.trim() ? [text] : [];
			}

			const separator = separators[separatorIndex];

			// If no more separators, force split
			if (separator === "" || separatorIndex >= separators.length - 1) {
				const parts: string[] = [];
				for (let i = 0; i < text.length; i += targetLength - overlapLength) {
					const part = text.slice(i, i + targetLength);
					if (part.trim()) {
						parts.push(part);
					}
				}
				return parts;
			}

			const splits = text.split(separator);
			const results: string[] = [];
			let currentChunk = "";

			for (const split of splits) {
				const potentialChunk = currentChunk
					? currentChunk + separator + split
					: split;

				if (potentialChunk.length <= targetLength) {
					currentChunk = potentialChunk;
				} else {
					if (currentChunk) {
						// Recursively split if still too large
						if (currentChunk.length > targetLength) {
							results.push(
								...splitRecursively(currentChunk, separatorIndex + 1)
							);
						} else {
							results.push(currentChunk);
						}
					}

					// Handle the new split
					if (split.length > targetLength) {
						results.push(...splitRecursively(split, separatorIndex + 1));
						currentChunk = "";
					} else {
						currentChunk = split;
					}
				}
			}

			if (currentChunk.trim()) {
				if (currentChunk.length > targetLength) {
					results.push(...splitRecursively(currentChunk, separatorIndex + 1));
				} else {
					results.push(currentChunk);
				}
			}

			return results;
		};

		const textChunks = splitRecursively(text, 0);

		// Add overlap between chunks
		let charPosition = 0;
		for (let i = 0; i < textChunks.length; i++) {
			const content = textChunks[i].trim();
			if (!content) continue;

			const startChar = text.indexOf(content, charPosition);
			const endChar = startChar + content.length;

			chunks.push({
				content,
				index: currentIndex++,
				startChar,
				endChar,
			});

			charPosition = Math.max(charPosition, endChar - overlapLength);
		}

		return chunks;
	},

	/**
	 * Add contextual prefix to chunks for better retrieval
	 * (Anthropic's Contextual Retrieval technique)
	 */
	addContextualPrefix(
		chunks: Chunk[],
		documentTitle: string,
		documentSummary?: string
	): Chunk[] {
		const prefix = documentSummary
			? `Document: ${documentTitle}\nSummary: ${documentSummary}\n\nContent: `
			: `Document: ${documentTitle}\n\nContent: `;

		return chunks.map((chunk) => ({
			...chunk,
			content: prefix + chunk.content,
		}));
	},
};
```

### src/services/rag.service.ts

```typescript
import { db } from "../db/index.js";
import { documents, documentChunks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { qdrantService, type VectorPayload } from "./qdrant.service.js";
import { llmService } from "./llm.service.js";
import { chunkingService, type ChunkOptions } from "./chunking.service.js";

export interface IndexDocumentOptions {
	title: string;
	content: string;
	source?: string;
	metadata?: Record<string, unknown>;
	chunkOptions?: ChunkOptions;
}

export interface QueryOptions {
	limit?: number;
	scoreThreshold?: number;
	filter?: {
		documentId?: string;
		source?: string;
	};
	stream?: boolean;
}

export interface QueryResult {
	answer: string;
	sources: Array<{
		documentId: string;
		chunkId: string;
		content: string;
		score: number;
	}>;
}

export const ragService = {
	/**
	 * Index a document into the RAG system
	 */
	async indexDocument(options: IndexDocumentOptions): Promise<string> {
		const { title, content, source, metadata, chunkOptions } = options;

		// 1. Create document record
		const [doc] = await db
			.insert(documents)
			.values({
				title,
				content,
				source,
				metadata,
				status: "processing",
			})
			.returning();

		try {
			// 2. Chunk the content
			const chunks = chunkingService.chunkText(content, chunkOptions);

			// 3. Generate embeddings for all chunks
			const chunkTexts = chunks.map((c) => c.content);
			const embeddings = await llmService.generateEmbeddings(chunkTexts);

			// 4. Prepare vectors for Qdrant and chunk records
			const vectorsToUpsert: Array<{
				id: string;
				embedding: number[];
				payload: VectorPayload;
			}> = [];

			const chunkRecords = chunks.map((chunk, index) => {
				const pointId = uuidv4();

				vectorsToUpsert.push({
					id: pointId,
					embedding: embeddings[index].embedding,
					payload: {
						documentId: doc.id,
						chunkId: pointId,
						content: chunk.content,
						chunkIndex: chunk.index,
						source,
						metadata,
					},
				});

				return {
					documentId: doc.id,
					content: chunk.content,
					chunkIndex: chunk.index,
					tokenCount: embeddings[index].tokenCount,
					qdrantPointId: pointId,
					metadata: {
						startChar: chunk.startChar,
						endChar: chunk.endChar,
					},
				};
			});

			// 5. Insert chunk records into PostgreSQL
			if (chunkRecords.length > 0) {
				await db.insert(documentChunks).values(chunkRecords);
			}

			// 6. Upsert vectors into Qdrant
			if (vectorsToUpsert.length > 0) {
				await qdrantService.upsertVectors(vectorsToUpsert);
			}

			// 7. Update document status
			await db
				.update(documents)
				.set({
					status: "indexed",
					chunkCount: chunks.length,
				})
				.where(eq(documents.id, doc.id));

			return doc.id;
		} catch (error) {
			// Mark document as failed
			await db
				.update(documents)
				.set({ status: "failed" })
				.where(eq(documents.id, doc.id));

			throw error;
		}
	},

	/**
	 * Query the RAG system
	 */
	async query(query: string, options: QueryOptions = {}): Promise<QueryResult> {
		const { limit = 5, scoreThreshold = 0.7, filter } = options;

		// 1. Generate query embedding
		const { embedding } = await llmService.generateEmbedding(query);

		// 2. Search Qdrant for relevant chunks
		const searchResults = await qdrantService.search(embedding, {
			limit,
			scoreThreshold,
			filter,
		});

		if (searchResults.length === 0) {
			return {
				answer:
					"I couldn't find any relevant information to answer your question.",
				sources: [],
			};
		}

		// 3. Extract context from search results
		const context = searchResults.map((r) => r.payload.content);

		// 4. Generate answer using LLM
		const answer = await llmService.generateRAGCompletion(query, context);

		// 5. Return answer with sources
		return {
			answer,
			sources: searchResults.map((r) => ({
				documentId: r.payload.documentId,
				chunkId: r.payload.chunkId,
				content: r.payload.content,
				score: r.score,
			})),
		};
	},

	/**
	 * Query with streaming response
	 */
	async *queryStream(
		query: string,
		options: QueryOptions = {}
	): AsyncGenerator<
		| { type: "sources"; data: QueryResult["sources"] }
		| { type: "token"; data: string },
		void,
		unknown
	> {
		const { limit = 5, scoreThreshold = 0.7, filter } = options;

		// 1. Generate query embedding
		const { embedding } = await llmService.generateEmbedding(query);

		// 2. Search Qdrant for relevant chunks
		const searchResults = await qdrantService.search(embedding, {
			limit,
			scoreThreshold,
			filter,
		});

		// 3. Yield sources first
		const sources = searchResults.map((r) => ({
			documentId: r.payload.documentId,
			chunkId: r.payload.chunkId,
			content: r.payload.content,
			score: r.score,
		}));

		yield { type: "sources", data: sources };

		if (searchResults.length === 0) {
			yield {
				type: "token",
				data: "I couldn't find any relevant information to answer your question.",
			};
			return;
		}

		// 4. Extract context and stream response
		const context = searchResults.map((r) => r.payload.content);

		for await (const token of llmService.generateStreamingRAGCompletion(
			query,
			context
		)) {
			yield { type: "token", data: token };
		}
	},

	/**
	 * Delete a document and its vectors
	 */
	async deleteDocument(documentId: string): Promise<void> {
		// Delete from Qdrant first
		await qdrantService.deleteByDocumentId(documentId);

		// Delete from PostgreSQL (cascades to chunks)
		await db.delete(documents).where(eq(documents.id, documentId));
	},
};
```

---

## 9. Streaming Responses (SSE)

### src/routes/chat.routes.ts

```typescript
import { Type, Static } from "@sinclair/typebox";
import type { FastifyTypebox } from "../types/fastify.js";
import { ragService } from "../services/rag.service.js";

// Schemas
const QueryBodySchema = Type.Object({
	query: Type.String({ minLength: 1, maxLength: 10000 }),
	options: Type.Optional(
		Type.Object({
			limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
			scoreThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
			documentId: Type.Optional(Type.String({ format: "uuid" })),
			source: Type.Optional(Type.String()),
		})
	),
});

const QueryResponseSchema = Type.Object({
	answer: Type.String(),
	sources: Type.Array(
		Type.Object({
			documentId: Type.String(),
			chunkId: Type.String(),
			content: Type.String(),
			score: Type.Number(),
		})
	),
});

type QueryBody = Static<typeof QueryBodySchema>;

export async function chatRoutes(fastify: FastifyTypebox) {
	// Non-streaming query endpoint
	fastify.post(
		"/query",
		{
			schema: {
				body: QueryBodySchema,
				response: {
					200: QueryResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { query, options } = request.body;

			const result = await ragService.query(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			return result;
		}
	);

	// Streaming query endpoint using SSE
	fastify.post(
		"/query/stream",
		{
			sse: true,
			schema: {
				body: QueryBodySchema,
			},
		},
		async (request, reply) => {
			const { query, options } = request.body;

			// Keep connection alive
			reply.sse.keepAlive();

			try {
				const stream = ragService.queryStream(query, {
					limit: options?.limit,
					scoreThreshold: options?.scoreThreshold,
					filter: {
						documentId: options?.documentId,
						source: options?.source,
					},
				});

				for await (const chunk of stream) {
					if (chunk.type === "sources") {
						await reply.sse.send({
							event: "sources",
							data: JSON.stringify(chunk.data),
						});
					} else {
						await reply.sse.send({
							event: "token",
							data: chunk.data,
						});
					}
				}

				// Send completion event
				await reply.sse.send({
					event: "done",
					data: "",
				});
			} catch (error) {
				await reply.sse.send({
					event: "error",
					data: JSON.stringify({
						message: error instanceof Error ? error.message : "Unknown error",
					}),
				});
			}
		}
	);

	// Alternative: Manual SSE without plugin (more control)
	fastify.post(
		"/query/stream-manual",
		{
			schema: {
				body: QueryBodySchema,
			},
		},
		async (request, reply) => {
			const { query, options } = request.body;

			// Set SSE headers
			reply.raw.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
			});

			const sendEvent = (event: string, data: string) => {
				reply.raw.write(`event: ${event}\n`);
				reply.raw.write(`data: ${data}\n\n`);
			};

			try {
				const stream = ragService.queryStream(query, {
					limit: options?.limit,
					scoreThreshold: options?.scoreThreshold,
					filter: {
						documentId: options?.documentId,
						source: options?.source,
					},
				});

				for await (const chunk of stream) {
					if (chunk.type === "sources") {
						sendEvent("sources", JSON.stringify(chunk.data));
					} else {
						sendEvent("token", chunk.data);
					}
				}

				sendEvent("done", "");
			} catch (error) {
				sendEvent(
					"error",
					JSON.stringify({
						message: error instanceof Error ? error.message : "Unknown error",
					})
				);
			} finally {
				reply.raw.end();
			}
		}
	);
}
```

### src/routes/documents.routes.ts

```typescript
import { Type, Static } from "@sinclair/typebox";
import type { FastifyTypebox } from "../types/fastify.js";
import { ragService } from "../services/rag.service.js";
import { db } from "../db/index.js";
import { documents } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Schemas
const CreateDocumentSchema = Type.Object({
	title: Type.String({ minLength: 1, maxLength: 500 }),
	content: Type.String({ minLength: 1 }),
	source: Type.Optional(Type.String({ maxLength: 1000 })),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const DocumentResponseSchema = Type.Object({
	id: Type.String({ format: "uuid" }),
	title: Type.String(),
	source: Type.Union([Type.String(), Type.Null()]),
	status: Type.String(),
	chunkCount: Type.Union([Type.Number(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
});

const DocumentIdParamsSchema = Type.Object({
	id: Type.String({ format: "uuid" }),
});

type CreateDocument = Static<typeof CreateDocumentSchema>;
type DocumentIdParams = Static<typeof DocumentIdParamsSchema>;

export async function documentRoutes(fastify: FastifyTypebox) {
	// Create and index a document
	fastify.post(
		"/",
		{
			schema: {
				body: CreateDocumentSchema,
				response: {
					201: Type.Object({
						id: Type.String({ format: "uuid" }),
						message: Type.String(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { title, content, source, metadata } = request.body;

			const documentId = await ragService.indexDocument({
				title,
				content,
				source,
				metadata,
			});

			reply.status(201);
			return {
				id: documentId,
				message: "Document indexed successfully",
			};
		}
	);

	// Get document by ID
	fastify.get(
		"/:id",
		{
			schema: {
				params: DocumentIdParamsSchema,
				response: {
					200: DocumentResponseSchema,
					404: Type.Object({
						error: Type.String(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { id } = request.params;

			const [doc] = await db
				.select({
					id: documents.id,
					title: documents.title,
					source: documents.source,
					status: documents.status,
					chunkCount: documents.chunkCount,
					createdAt: documents.createdAt,
					updatedAt: documents.updatedAt,
				})
				.from(documents)
				.where(eq(documents.id, id));

			if (!doc) {
				reply.status(404);
				return { error: "Document not found" };
			}

			return {
				...doc,
				createdAt: doc.createdAt.toISOString(),
				updatedAt: doc.updatedAt.toISOString(),
			};
		}
	);

	// List documents
	fastify.get(
		"/",
		{
			schema: {
				querystring: Type.Object({
					limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
					offset: Type.Optional(Type.Number({ minimum: 0 })),
				}),
				response: {
					200: Type.Object({
						documents: Type.Array(DocumentResponseSchema),
						total: Type.Number(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { limit = 20, offset = 0 } = request.query;

			const docs = await db
				.select({
					id: documents.id,
					title: documents.title,
					source: documents.source,
					status: documents.status,
					chunkCount: documents.chunkCount,
					createdAt: documents.createdAt,
					updatedAt: documents.updatedAt,
				})
				.from(documents)
				.limit(limit)
				.offset(offset);

			return {
				documents: docs.map((doc) => ({
					...doc,
					createdAt: doc.createdAt.toISOString(),
					updatedAt: doc.updatedAt.toISOString(),
				})),
				total: docs.length,
			};
		}
	);

	// Delete document
	fastify.delete(
		"/:id",
		{
			schema: {
				params: DocumentIdParamsSchema,
				response: {
					200: Type.Object({
						message: Type.String(),
					}),
					404: Type.Object({
						error: Type.String(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { id } = request.params;

			// Check if document exists
			const [doc] = await db
				.select({ id: documents.id })
				.from(documents)
				.where(eq(documents.id, id));

			if (!doc) {
				reply.status(404);
				return { error: "Document not found" };
			}

			await ragService.deleteDocument(id);

			return { message: "Document deleted successfully" };
		}
	);
}
```

### src/routes/index.ts

```typescript
import type { FastifyTypebox } from "../types/fastify.js";
import { chatRoutes } from "./chat.routes.js";
import { documentRoutes } from "./documents.routes.js";
import { qdrantService } from "../services/qdrant.service.js";

export async function registerRoutes(fastify: FastifyTypebox) {
	// Initialize Qdrant collection
	await qdrantService.initializeCollection();

	// Health check
	fastify.get("/health", async () => ({
		status: "ok",
		timestamp: new Date().toISOString(),
	}));

	// Register route modules
	await fastify.register(chatRoutes, { prefix: "/api/chat" });
	await fastify.register(documentRoutes, { prefix: "/api/documents" });
}
```

---

## 10. Error Handling & Validation

### src/middleware/error-handler.ts

```typescript
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

interface ErrorResponse {
	error: string;
	message: string;
	statusCode: number;
	details?: unknown;
}

export function errorHandler(
	error: FastifyError,
	request: FastifyRequest,
	reply: FastifyReply
) {
	request.log.error(error);

	const response: ErrorResponse = {
		error: error.name || "Error",
		message: error.message,
		statusCode: error.statusCode || 500,
	};

	// Handle validation errors
	if (error.validation) {
		response.error = "ValidationError";
		response.statusCode = 400;
		response.details = error.validation.map((v) => ({
			field: v.instancePath || "body",
			message: v.message,
		}));
	}

	// Handle specific error types
	if (error.message.includes("rate limit")) {
		response.error = "RateLimitError";
		response.statusCode = 429;
		response.message = "Too many requests. Please try again later.";
	}

	if (error.message.includes("API key")) {
		response.error = "AuthenticationError";
		response.statusCode = 401;
		response.message = "Invalid or missing API key.";
	}

	// Don't expose internal errors in production
	if (response.statusCode === 500 && env.NODE_ENV === "production") {
		response.message = "An internal server error occurred.";
	}

	reply.status(response.statusCode).send(response);
}
```

### src/utils/errors.ts

```typescript
export class AppError extends Error {
	constructor(
		public message: string,
		public statusCode: number = 500,
		public code?: string
	) {
		super(message);
		this.name = "AppError";
		Error.captureStackTrace(this, this.constructor);
	}
}

export class NotFoundError extends AppError {
	constructor(resource: string) {
		super(`${resource} not found`, 404, "NOT_FOUND");
		this.name = "NotFoundError";
	}
}

export class ValidationError extends AppError {
	constructor(message: string) {
		super(message, 400, "VALIDATION_ERROR");
		this.name = "ValidationError";
	}
}

export class ConflictError extends AppError {
	constructor(message: string) {
		super(message, 409, "CONFLICT");
		this.name = "ConflictError";
	}
}
```

---

## 11. Production Considerations

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Use connection pooling for PostgreSQL
DATABASE_URL=postgresql://user:password@host:5432/db?sslmode=require

# Use Qdrant Cloud in production
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your-production-api-key

# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-production-key
```

### Docker Compose for Development

```yaml
# docker-compose.yml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: rag_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d rag_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334

volumes:
  postgres_data:
  qdrant_data:
```

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### Performance Tips

1. **Connection Pooling**: Use PostgreSQL connection pooling (built into `postgres` package)
2. **Batch Embeddings**: Use `generateEmbeddings` for multiple texts to reduce API calls
3. **Caching**: Consider Redis for caching frequent queries
4. **Quantization**: Enable Qdrant quantization for larger collections
5. **Rate Limiting**: Implement proper rate limiting for API endpoints
6. **Graceful Shutdown**: Handle SIGTERM properly for container orchestration

---

## 12. Complete File Structure

```
fastify-rag-api/
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts
│   ├── middleware/
│   │   └── error-handler.ts
│   ├── routes/
│   │   ├── index.ts
│   │   ├── chat.routes.ts
│   │   └── documents.routes.ts
│   ├── services/
│   │   ├── chunking.service.ts
│   │   ├── llm.service.ts
│   │   ├── qdrant.service.ts
│   │   └── rag.service.ts
│   ├── types/
│   │   └── fastify.ts
│   ├── utils/
│   │   └── errors.ts
│   └── server.ts
├── drizzle/
│   └── (generated migrations)
├── .env
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Quick Start Commands

```bash
# 1. Start local services
docker compose up -d

# 2. Run database migrations
npm run db:push

# 3. Start development server
npm run dev

# 4. Test endpoints
# Index a document
curl -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Doc", "content": "This is test content for RAG."}'

# Query (non-streaming)
curl -X POST http://localhost:3000/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is in the test document?"}'

# Query (streaming)
curl -X POST http://localhost:3000/api/chat/query/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"query": "What is in the test document?"}'
```

---

## Key Implementation Notes

1. **Type Safety**: All routes use TypeBox schemas for both request validation and TypeScript inference
2. **OpenRouter Integration**: Uses standard OpenAI SDK with `baseURL` pointing to OpenRouter
3. **Streaming**: Supports both SSE plugin and manual streaming approaches
4. **Hybrid Search Ready**: Qdrant collection configured for both dense and sparse vectors
5. **Production Ready**: Includes error handling, rate limiting, CORS, and security headers
6. **Drizzle ORM**: Modern, type-safe ORM with automatic migrations

---

_Last Updated: December 2025_
