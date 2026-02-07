import { relations } from "drizzle-orm";
import {
	pgTable,
	text,
	timestamp,
	integer,
	jsonb,
	pgEnum,
	index,
	boolean,
	real,
} from "drizzle-orm/pg-core";
import { user } from "../auth/schema";

// Enums
export const documentStatusEnum = pgEnum("document_status", [
	"pending",
	"processing",
	"indexed",
	"failed",
]);

export const messageRoleEnum = pgEnum("message_role", [
	"user",
	"assistant",
	"system",
]);

// RAG Profile table - stores all settings for the pipeline
export const ragProfile = pgTable("rag_profile", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.references(() => user.id, { onDelete: "cascade" })
		.notNull(),
	name: text("name").notNull(),
	description: text("description"),
	isDefault: boolean("is_default").default(false).notNull(),

	// Document Processing
	embeddingModel: text("embedding_model")
		.default("openai/text-embedding-3-small")
		.notNull(),
	chunkSize: integer("chunk_size").default(500).notNull(),
	chunkOverlap: integer("chunk_overlap").default(50).notNull(),
	separators: jsonb("separators")
		.$type<string[]>()
		.default(["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""])
		.notNull(),
	addContextualPrefix: boolean("add_contextual_prefix").default(true).notNull(),

	// Retrieval Settings
	retrievalStrategy: text("retrieval_strategy").default("similarity").notNull(), // similarity, mmr, hybrid
	scoreThreshold: real("score_threshold").default(0.3).notNull(),
	topK: integer("top_k").default(5).notNull(),

	// LLM Generation
	model: text("model").default("google/gemini-2.5-flash-lite").notNull(),
	temperature: real("temperature").default(0.7).notNull(),
	topP: real("top_p").default(1.0).notNull(),
	maxTokens: integer("max_tokens").default(2048).notNull(),
	reasoningEffort: text("reasoning_effort").default("none").notNull(), // none, minimal, moderate, high

	// Personality
	assistantName: text("assistant_name").default("Assistant").notNull(),
	companyName: text("company_name"),
	domain: text("domain"),
	tone: text("tone").default("friendly").notNull(),
	responseLength: text("response_length").default("balanced").notNull(),
	language: text("language").default("English").notNull(),
	enableCitations: boolean("enable_citations").default(true).notNull(),
	systemPrompt: text("system_prompt"),
	customInstructions: jsonb("custom_instructions")
		.$type<string[]>()
		.default([])
		.notNull(),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

// Documents table - stores document metadata
export const document = pgTable(
	"document",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.references(() => user.id, { onDelete: "cascade" })
			.notNull(),
		profileId: text("profile_id").references(() => ragProfile.id),
		title: text("title").notNull(),
		content: text("content").notNull(),
		source: text("source"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		status: documentStatusEnum("status").default("pending").notNull(),
		chunkCount: integer("chunk_count").default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("document_status_idx").on(table.status),
		index("document_profile_idx").on(table.profileId),
		index("document_userId_idx").on(table.userId),
	]
);

// Document chunks table - stores chunked content with vector references
export const documentChunk = pgTable(
	"document_chunk",
	{
		id: text("id").primaryKey(),
		documentId: text("document_id")
			.references(() => document.id, { onDelete: "cascade" })
			.notNull(),
		content: text("content").notNull(),
		chunkIndex: integer("chunk_index").notNull(),
		tokenCount: integer("token_count"),
		qdrantPointId: text("qdrant_point_id"), // Reference to Qdrant vector
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("chunk_documentId_idx").on(table.documentId),
		index("chunk_qdrantPointId_idx").on(table.qdrantPointId),
	]
);

// Conversations table - stores chat history
export const conversation = pgTable(
	"conversation",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.references(() => user.id, { onDelete: "cascade" })
			.notNull(),
		profileId: text("profile_id").references(() => ragProfile.id),
		title: text("title"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("conversation_profile_idx").on(table.profileId),
		index("conversation_userId_idx").on(table.userId),
	]
);

// Messages table - stores individual messages
export const message = pgTable(
	"message",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.references(() => conversation.id, { onDelete: "cascade" })
			.notNull(),
		role: messageRoleEnum("role").notNull(),
		content: text("content").notNull(),
		tokenCount: integer("token_count"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("message_conversationId_idx").on(table.conversationId)]
);

// Relations
export const ragProfileRelations = relations(ragProfile, ({ one, many }) => ({
	user: one(user, {
		fields: [ragProfile.userId],
		references: [user.id],
	}),
	documents: many(document),
	conversations: many(conversation),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
	user: one(user, {
		fields: [document.userId],
		references: [user.id],
	}),
	chunks: many(documentChunk),
	profile: one(ragProfile, {
		fields: [document.profileId],
		references: [ragProfile.id],
	}),
}));

export const documentChunkRelations = relations(documentChunk, ({ one }) => ({
	document: one(document, {
		fields: [documentChunk.documentId],
		references: [document.id],
	}),
}));

export const conversationRelations = relations(
	conversation,
	({ one, many }) => ({
		user: one(user, {
			fields: [conversation.userId],
			references: [user.id],
		}),
		messages: many(message),
		profile: one(ragProfile, {
			fields: [conversation.profileId],
			references: [ragProfile.id],
		}),
	})
);

export const messageRelations = relations(message, ({ one }) => ({
	conversation: one(conversation, {
		fields: [message.conversationId],
		references: [conversation.id],
	}),
}));
