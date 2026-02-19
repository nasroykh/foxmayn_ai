import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { authProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	conversationInsertSchema,
	conversationUpdateSchema,
	messageInsertSchema,
	messageUpdateSchema,
} from "@repo/db/types";
import {
	createConversation,
	getConversation,
	getConversationWithMessages,
	listConversations,
	countConversations,
	updateConversation,
	deleteConversation,
	createMessage,
	getMessage,
	listMessages,
	countMessages,
	updateMessage,
	deleteMessage,
	clearConversationMessages,
} from "../../services/conversation.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// ============================================================================
// CONVERSATION ROUTES
// ============================================================================

export const conversationRoutes = {
	// --- Conversation CRUD ---

	createConversation: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/conversations`,
			description: "Create a new conversation",
		})
		.input(
			conversationInsertSchema.omit({
				id: true,
				userId: true,
				createdAt: true,
				updatedAt: true,
			})
		)
		.handler(async ({ input, context }) => {
			const conv = await createConversation({
				...input,
				userId: context.user.id,
			});
			return conv;
		}),

	listConversations: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/conversations`,
			description: "List conversations with pagination",
		})
		.input(
			z.object({
				offset: z.coerce.number().min(0).optional(),
				limit: z.coerce.number().min(1).max(100).optional(),
				profileId: z.string().optional(),
			})
		)
		.output(
			z.object({
				conversations: z.array(
					z.object({
						id: z.string(),
						profileId: z.string().nullable(),
						title: z.string().nullable(),
						metadata: z.record(z.string(), z.unknown()).nullable(),
						createdAt: z.string(),
						updatedAt: z.string(),
					})
				),
				total: z.number(),
			})
		)
		.handler(async ({ input, context }) => {
			const { limit = 20, offset = 0, profileId } = input;
			const userId = context.user.id;
			const [conversations, total] = await Promise.all([
				listConversations(limit, offset, profileId, userId),
				countConversations(profileId, userId),
			]);

			return {
				conversations: conversations.map((conv) => ({
					id: conv.id,
					profileId: conv.profileId,
					title: conv.title,
					metadata: conv.metadata as Record<string, unknown> | null,
					createdAt: conv.createdAt.toISOString(),
					updatedAt: conv.updatedAt.toISOString(),
				})),
				total,
			};
		}),

	getConversation: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/conversations/{id}`,
			description: "Get a conversation by ID",
		})
		.input(z.object({ id: z.string() }))
		.output(
			z.object({
				id: z.string(),
				profileId: z.string().nullable(),
				title: z.string().nullable(),
				metadata: z.record(z.string(), z.unknown()).nullable(),
				createdAt: z.string(),
				updatedAt: z.string(),
			})
		)
		.handler(async ({ input, context }) => {
			const conv = await getConversation(input.id, context.user.id);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}
			return {
				id: conv.id,
				profileId: conv.profileId,
				title: conv.title,
				metadata: conv.metadata as Record<string, unknown> | null,
				createdAt: conv.createdAt.toISOString(),
				updatedAt: conv.updatedAt.toISOString(),
			};
		}),

	getConversationWithMessages: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/conversations/{id}/full`,
			description: "Get a conversation with all its messages",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input, context }) => {
			const conv = await getConversationWithMessages(
				input.id,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}
			return {
				id: conv.id,
				profileId: conv.profileId,
				title: conv.title,
				metadata: conv.metadata as Record<string, unknown> | null,
				createdAt: conv.createdAt.toISOString(),
				updatedAt: conv.updatedAt.toISOString(),
				messages: conv.messages.map((msg) => ({
					id: msg.id,
					role: msg.role,
					content: msg.content,
					tokenCount: msg.tokenCount,
					metadata: msg.metadata as Record<string, unknown> | null,
					createdAt: msg.createdAt.toISOString(),
					updatedAt: msg.updatedAt.toISOString(),
				})),
			};
		}),

	updateConversation: authProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/conversations/{id}`,
			description: "Update a conversation",
		})
		.input(
			z.object({
				id: z.string(),
				data: conversationUpdateSchema.omit({
					id: true,
					userId: true,
					createdAt: true,
				}),
			})
		)
		.handler(async ({ input, context }) => {
			const conv = await updateConversation(
				input.id,
				input.data,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}
			return {
				id: conv.id,
				profileId: conv.profileId,
				title: conv.title,
				metadata: conv.metadata as Record<string, unknown> | null,
				createdAt: conv.createdAt.toISOString(),
				updatedAt: conv.updatedAt.toISOString(),
			};
		}),

	deleteConversation: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/conversations/{id}`,
			description: "Delete a conversation and all its messages",
		})
		.input(z.object({ id: z.string() }))
		.output(z.object({ message: z.string() }))
		.handler(async ({ input, context }) => {
			const conv = await getConversation(input.id, context.user.id);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}
			await deleteConversation(input.id, context.user.id);
			return { message: "Conversation deleted" };
		}),

	// --- Message CRUD ---

	createMessage: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/conversations/{conversationId}/messages`,
			description: "Create a new message in a conversation",
		})
		.input(
			z.object({
				conversationId: z.string(),
				data: messageInsertSchema.omit({
					id: true,
					conversationId: true,
					createdAt: true,
					updatedAt: true,
				}),
			})
		)
		.handler(async ({ input, context }) => {
			const conv = await getConversation(
				input.conversationId,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}

			const msg = await createMessage({
				...input.data,
				conversationId: input.conversationId,
			});

			return {
				id: msg.id,
				conversationId: msg.conversationId,
				role: msg.role,
				content: msg.content,
				tokenCount: msg.tokenCount,
				metadata: msg.metadata as Record<string, unknown> | null,
				createdAt: msg.createdAt.toISOString(),
				updatedAt: msg.updatedAt.toISOString(),
			};
		}),

	listMessages: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/conversations/{conversationId}/messages`,
			description: "List messages in a conversation",
		})
		.input(
			z.object({
				conversationId: z.string(),
				offset: z.coerce.number().min(0).optional(),
				limit: z.coerce.number().min(1).max(100).optional(),
			})
		)
		.output(
			z.object({
				messages: z.array(
					z.object({
						id: z.string(),
						conversationId: z.string(),
						role: z.enum(["user", "assistant", "system"]),
						content: z.string(),
						tokenCount: z.number().nullable(),
						metadata: z.record(z.string(), z.unknown()).nullable(),
						createdAt: z.string(),
						updatedAt: z.string(),
					})
				),
				total: z.number(),
			})
		)
		.handler(async ({ input, context }) => {
			const { conversationId, limit = 50, offset = 0 } = input;

			const conv = await getConversation(conversationId, context.user.id);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}

			const [messages, total] = await Promise.all([
				listMessages(conversationId, limit, offset),
				countMessages(conversationId),
			]);

			return {
				messages: messages.map((msg) => ({
					id: msg.id,
					conversationId: msg.conversationId,
					role: msg.role,
					content: msg.content,
					tokenCount: msg.tokenCount,
					metadata: msg.metadata as Record<string, unknown> | null,
					createdAt: msg.createdAt.toISOString(),
					updatedAt: msg.updatedAt.toISOString(),
				})),
				total,
			};
		}),

	getMessage: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/conversations/{conversationId}/messages/{id}`,
			description: "Get a specific message by ID",
		})
		.input(
			z.object({
				conversationId: z.string(),
				id: z.string(),
			})
		)
		.handler(async ({ input, context }) => {
			// Verify conversation ownership first
			const conv = await getConversation(
				input.conversationId,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}

			const msg = await getMessage(input.id);
			if (!msg || msg.conversationId !== input.conversationId) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}
			return {
				id: msg.id,
				conversationId: msg.conversationId,
				role: msg.role,
				content: msg.content,
				tokenCount: msg.tokenCount,
				metadata: msg.metadata as Record<string, unknown> | null,
				createdAt: msg.createdAt.toISOString(),
				updatedAt: msg.updatedAt.toISOString(),
			};
		}),

	updateMessage: authProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/conversations/{conversationId}/messages/{id}`,
			description: "Update a message",
		})
		.input(
			z.object({
				conversationId: z.string(),
				id: z.string(),
				data: messageUpdateSchema.omit({
					id: true,
					conversationId: true,
					createdAt: true,
				}),
			})
		)
		.handler(async ({ input, context }) => {
			// Verify conversation ownership
			const conv = await getConversation(
				input.conversationId,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}

			const existingMsg = await getMessage(input.id);
			if (!existingMsg || existingMsg.conversationId !== input.conversationId) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}

			const msg = await updateMessage(input.id, input.data);
			if (!msg) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}

			return {
				id: msg.id,
				conversationId: msg.conversationId,
				role: msg.role,
				content: msg.content,
				tokenCount: msg.tokenCount,
				metadata: msg.metadata as Record<string, unknown> | null,
				createdAt: msg.createdAt.toISOString(),
				updatedAt: msg.updatedAt.toISOString(),
			};
		}),

	deleteMessage: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/conversations/{conversationId}/messages/{id}`,
			description: "Delete a message",
		})
		.input(
			z.object({
				conversationId: z.string(),
				id: z.string(),
			})
		)
		.output(z.object({ message: z.string() }))
		.handler(async ({ input, context }) => {
			// Verify conversation ownership
			const conv = await getConversation(
				input.conversationId,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}

			const existingMsg = await getMessage(input.id);
			if (!existingMsg || existingMsg.conversationId !== input.conversationId) {
				throw new ORPCError("NOT_FOUND", { message: "Message not found" });
			}

			await deleteMessage(input.id);
			return { message: "Message deleted" };
		}),

	clearMessages: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/conversations/{conversationId}/messages`,
			description: "Clear all messages in a conversation",
		})
		.input(z.object({ conversationId: z.string() }))
		.output(z.object({ message: z.string() }))
		.handler(async ({ input, context }) => {
			const conv = await getConversation(
				input.conversationId,
				context.user.id
			);
			if (!conv) {
				throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
			}

			await clearConversationMessages(input.conversationId);
			return { message: "All messages cleared" };
		}),
};
