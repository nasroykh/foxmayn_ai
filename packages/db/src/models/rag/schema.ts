import { relations } from "drizzle-orm";
import {
	pgTable,
	text,
	timestamp,
	integer,
	jsonb,
	pgEnum,
	index,
} from "drizzle-orm/pg-core";

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

// Documents table - stores document metadata
export const document = pgTable(
	"document",
	{
		id: text("id").primaryKey(),
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
	(table) => [index("document_status_idx").on(table.status)]
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
export const conversation = pgTable("conversation", {
	id: text("id").primaryKey(),
	title: text("title"),
	metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

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
export const documentRelations = relations(document, ({ many }) => ({
	chunks: many(documentChunk),
}));

export const documentChunkRelations = relations(documentChunk, ({ one }) => ({
	document: one(document, {
		fields: [documentChunk.documentId],
		references: [document.id],
	}),
}));

export const conversationRelations = relations(conversation, ({ many }) => ({
	messages: many(message),
}));

export const messageRelations = relations(message, ({ one }) => ({
	conversation: one(conversation, {
		fields: [message.conversationId],
		references: [conversation.id],
	}),
}));

