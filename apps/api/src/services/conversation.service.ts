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
export const getConversation = async (id: string, userId?: string) => {
	const conditions = [eq(conversation.id, id)];
	if (userId) conditions.push(eq(conversation.userId, userId));

	const [conv] = await db
		.select()
		.from(conversation)
		.where(and(...conditions));
	return conv || null;
};

/**
 * Get a conversation by ID with its messages (scoped to user)
 */
export const getConversationWithMessages = async (
	id: string,
	userId?: string,
) => {
	const conditions = [eq(conversation.id, id)];
	if (userId) conditions.push(eq(conversation.userId, userId));

	const [conv] = await db
		.select()
		.from(conversation)
		.where(and(...conditions));

	if (!conv) return null;

	const messages = await db
		.select()
		.from(message)
		.where(eq(message.conversationId, id))
		.orderBy(message.createdAt);

	return { ...conv, messages };
};

/**
 * List all conversations with optional profile filter (scoped to user)
 */
export const listConversations = async (
	limit = 20,
	offset = 0,
	profileId?: string,
	userId?: string,
) => {
	const conditions = [];
	if (userId) conditions.push(eq(conversation.userId, userId));
	if (profileId) conditions.push(eq(conversation.profileId, profileId));

	const query = db
		.select()
		.from(conversation)
		.limit(limit)
		.offset(offset)
		.orderBy(desc(conversation.updatedAt));

	if (conditions.length > 0) {
		return await query.where(and(...conditions));
	}

	return await query;
};

/**
 * Count total conversations with optional profile filter (scoped to user)
 */
export const countConversations = async (
	profileId?: string,
	userId?: string,
) => {
	const conditions = [];
	if (userId) conditions.push(eq(conversation.userId, userId));
	if (profileId) conditions.push(eq(conversation.profileId, profileId));

	if (conditions.length > 0) {
		const [result] = await db
			.select({ count: count() })
			.from(conversation)
			.where(and(...conditions));
		return result?.count ?? 0;
	}

	const [result] = await db.select({ count: count() }).from(conversation);
	return result?.count ?? 0;
};

/**
 * Update a conversation (scoped to user)
 */
export const updateConversation = async (
	id: string,
	data: Partial<ConversationUpdate>,
	userId?: string,
) => {
	const conditions = [eq(conversation.id, id)];
	if (userId) conditions.push(eq(conversation.userId, userId));

	const [updatedConversation] = await db
		.update(conversation)
		.set(data)
		.where(and(...conditions))
		.returning();
	return updatedConversation;
};

/**
 * Delete a conversation (cascades to messages, scoped to user)
 */
export const deleteConversation = async (id: string, userId?: string) => {
	const conditions = [eq(conversation.id, id)];
	if (userId) conditions.push(eq(conversation.userId, userId));

	await db.delete(conversation).where(and(...conditions));
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
