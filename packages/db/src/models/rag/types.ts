import { z } from "zod";
import {
	createInsertSchema,
	createSelectSchema,
	createUpdateSchema,
} from "drizzle-zod";
import {
	document,
	documentChunk,
	conversation,
	message,
	ragProfile,
} from "./schema";

// Document schemas
export const documentSelectSchema = createSelectSchema(document);
export type Document = z.infer<typeof documentSelectSchema>;

export const documentInsertSchema = createInsertSchema(document);
export type DocumentInsert = z.infer<typeof documentInsertSchema>;

export const documentUpdateSchema = createUpdateSchema(document);
export type DocumentUpdate = z.infer<typeof documentUpdateSchema>;

// Document chunk schemas
export const documentChunkSelectSchema = createSelectSchema(documentChunk);
export type DocumentChunk = z.infer<typeof documentChunkSelectSchema>;

export const documentChunkInsertSchema = createInsertSchema(documentChunk);
export type DocumentChunkInsert = z.infer<typeof documentChunkInsertSchema>;

// Conversation schemas
export const conversationSelectSchema = createSelectSchema(conversation);
export type Conversation = z.infer<typeof conversationSelectSchema>;

export const conversationInsertSchema = createInsertSchema(conversation);
export type ConversationInsert = z.infer<typeof conversationInsertSchema>;

export const conversationUpdateSchema = createUpdateSchema(conversation);
export type ConversationUpdate = z.infer<typeof conversationUpdateSchema>;

// Message schemas
export const messageSelectSchema = createSelectSchema(message);
export type Message = z.infer<typeof messageSelectSchema>;

export const messageInsertSchema = createInsertSchema(message);
export type MessageInsert = z.infer<typeof messageInsertSchema>;

export const messageUpdateSchema = createUpdateSchema(message);
export type MessageUpdate = z.infer<typeof messageUpdateSchema>;

// RAG Profile schemas
export const ragProfileSelectSchema = createSelectSchema(ragProfile);
export type RagProfile = z.infer<typeof ragProfileSelectSchema>;

export const ragProfileInsertSchema = createInsertSchema(ragProfile);
export type RagProfileInsert = z.infer<typeof ragProfileInsertSchema>;

export const ragProfileUpdateSchema = createUpdateSchema(ragProfile);
export type RagProfileUpdate = z.infer<typeof ragProfileUpdateSchema>;
