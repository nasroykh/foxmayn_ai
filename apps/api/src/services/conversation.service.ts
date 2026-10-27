import { db, conversation, message } from "@repo/db";
import { eq, desc, and, count } from "@repo/db/drizzle-orm";
import {
	type ConversationInsert,
	type ConversationUpdate,
	type MessageInsert,
	type MessageUpdate,
} from "@repo/db/types";
import { randomUUID } from "node:crypto";

// ============================================================================
// CONVERSATION SERVICES
// ============================================================================

/**
 * Create a new conversation
 */
export const createConversation = async (
	data: Omit<ConversationInsert, "id" | "createdAt" | "updatedAt">,
) => {
	const id = randomUUID();
	const [newConversation] = await db
		.insert(conversation)
		.values({ ...data, id })
		.returning();
	return newConversation;
};

/**
 * Get a conversation by ID (scoped to user)
 */
export const getConversation = async (id: string, userId: string) => {
	const [conv] = await db
		.select()
		.from(conversation)
		.where(and(eq(conversation.id, id), eq(conversation.userId, userId)));
	return conv || null;
};

/**
 * Get a conversation by ID with its messages (scoped to user)
 */
export const getConversationWithMessages = async (
	id: string,
	userId: string,
) => {
	const conv = await getConversation(id, userId);
	if (!conv) return null;

	const messages = await db
		.select()
		.from(message)
		.where(eq(message.conversationId, id))
		.orderBy(message.createdAt);

	return { ...conv, messages };
};

/**
 * List conversations with optional profile filter (scoped to user)
 */
export const listConversations = async (
	limit: number,
	offset: number,
	profileId: string | undefined,
	userId: string,
) => {
	const conditions = [eq(conversation.userId, userId)];
	if (profileId) conditions.push(eq(conversation.profileId, profileId));

	return await db
		.select()
		.from(conversation)
		.where(and(...conditions))
		.limit(limit)
		.offset(offset)
		.orderBy(desc(conversation.updatedAt));
};

/**
 * Count total conversations with optional profile filter (scoped to user)
 */
export const countConversations = async (
	profileId: string | undefined,
	userId: string,
) => {
	const conditions = [eq(conversation.userId, userId)];
	if (profileId) conditions.push(eq(conversation.profileId, profileId));

	const [result] = await db
		.select({ count: count() })
		.from(conversation)
		.where(and(...conditions));
	return result?.count ?? 0;
};

/**
 * Update a conversation (scoped to user)
 */
export const updateConversation = async (
	id: string,
	data: Partial<ConversationUpdate>,
	userId: string,
) => {
	const [updatedConversation] = await db
		.update(conversation)
		.set(data)
		.where(and(eq(conversation.id, id), eq(conversation.userId, userId)))
		.returning();
	return updatedConversation;
};

/**
 * Delete a conversation (cascades to messages, scoped to user)
 */
export const deleteConversation = async (id: string, userId: string) => {
	await db
		.delete(conversation)
		.where(and(eq(conversation.id, id), eq(conversation.userId, userId)));
};

// ============================================================================
// MESSAGE SERVICES
// ============================================================================

/**
 * Create a new message
 */
export const createMessage = async (
	data: Omit<MessageInsert, "id" | "createdAt" | "updatedAt">,
) => {
	const id = randomUUID();
	const [newMessage] = await db
		.insert(message)
		.values({ ...data, id })
		.returning();

	// Update conversation's updatedAt timestamp
	await db
		.update(conversation)
		.set({ updatedAt: new Date() })
		.where(eq(conversation.id, data.conversationId));

	return newMessage;
};

/**
 * Get a message by ID
 */
export const getMessage = async (id: string) => {
	const [msg] = await db.select().from(message).where(eq(message.id, id));
	return msg || null;
};

/**
 * List messages for a conversation
 */
export const listMessages = async (
	conversationId: string,
	limit = 50,
	offset = 0,
) => {
	return await db
		.select()
		.from(message)
		.where(eq(message.conversationId, conversationId))
		.limit(limit)
		.offset(offset)
		.orderBy(message.createdAt);
};

/**
 * The newest `limit` messages of a conversation, newest first.
 * Callers that replay history to the model reverse them (see selectHistory).
 */
export const listRecentMessages = async (
	conversationId: string,
	limit: number,
) => {
	return await db
		.select({ role: message.role, content: message.content })
		.from(message)
		.where(eq(message.conversationId, conversationId))
		.orderBy(desc(message.createdAt))
		.limit(limit);
};

/**
 * Count messages in a conversation
 */
export const countMessages = async (conversationId: string) => {
	const [result] = await db
		.select({ count: count() })
		.from(message)
		.where(eq(message.conversationId, conversationId));
	return result?.count ?? 0;
};

/**
 * Update a message
 */
export const updateMessage = async (
	id: string,
	data: Partial<MessageUpdate>,
) => {
	const [updatedMessage] = await db
		.update(message)
		.set(data)
		.where(eq(message.id, id))
		.returning();
	return updatedMessage;
};

/**
 * Delete a message
 */
export const deleteMessage = async (id: string) => {
	await db.delete(message).where(eq(message.id, id));
};

/**
 * Delete all messages in a conversation
 */
export const clearConversationMessages = async (conversationId: string) => {
	await db.delete(message).where(eq(message.conversationId, conversationId));
};
