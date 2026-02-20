import { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
	queryRAG,
	queryRAGStream,
	searchChunks,
	type ChatMessage,
} from "../../services/rag.service";
import {
	createConversation,
	getConversation,
	listMessages,
	createMessage,
} from "../../services/conversation.service";
import { authProcedure, publicProcedure } from "../middleware";
import { env } from "../../config/env";
import { OPENROUTER_AI_MODELS } from "@repo/llm/openrouter/models";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// Shared message schema
const messageSchema = z.object({
	role: z.enum(["user", "assistant", "system"]),
	content: z.string(),
});

// Base options schema (shared between query endpoints)
const queryOptionsSchema = z
	.object({
		limit: z.number().min(1).max(20).optional(),
		scoreThreshold: z.number().min(0).max(1).optional(),
		documentId: z.string().optional(),
		source: z.string().optional(),
		profileId: z.string().optional(),
	})
	.optional();

// Request schema for query endpoints
// Supports two modes:
// 1. Client-managed history: provide `messages` array
// 2. Server-managed history: provide `conversationId` (or nothing for new conversation)
const queryBodySchema = z
	.object({
		query: z.string().min(1).max(10000),
		// Client-managed mode: caller handles their own history
		messages: z.array(messageSchema).optional(),
		// Server-managed mode: we handle history storage
		conversationId: z.string().optional(),
		options: queryOptionsSchema,
	})
	.refine(
		(data) => !(data.messages && data.conversationId),
		"Cannot provide both 'messages' and 'conversationId'. Choose one mode.",
	);

/**
 * Resolves chat history based on the provided mode.
 * Returns messages array and conversationId (created if needed).
 */
async function resolveChatHistory(input: {
	messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
	conversationId?: string;
	profileId?: string;
	userId: string;
}): Promise<{
	messages: ChatMessage[];
	conversationId: string | null;
	isServerManaged: boolean;
}> {
	// Mode 1: Client-managed - caller provides their own messages
	if (input.messages?.length) {
		return {
			messages: input.messages,
			conversationId: null,
			isServerManaged: false,
		};
	}

	// Mode 2: Server-managed - we handle storage
	if (input.conversationId) {
		// Continuing an existing conversation
		const conv = await getConversation(input.conversationId, input.userId);
		if (!conv) {
			throw new ORPCError("NOT_FOUND", {
				message: "Conversation not found",
			});
		}

		// Fetch existing messages
		const existingMessages = await listMessages(input.conversationId, 50, 0);
		const messages: ChatMessage[] = existingMessages.map((m) => ({
			role: m.role as ChatMessage["role"],
			content: m.content,
		}));

		return {
			messages,
			conversationId: input.conversationId,
			isServerManaged: true,
		};
	}

	// Mode 2: New conversation (no conversationId provided, no messages)
	// Create a new conversation - will be populated after first exchange
	const conv = await createConversation({
		userId: input.userId,
		profileId: input.profileId ?? null,
		title: null, // Will be set later or remain null
	});

	return {
		messages: [],
		conversationId: conv.id,
		isServerManaged: true,
	};
}

/**
 * Stores the user query and assistant response in the conversation.
 */
async function storeMessages(
	conversationId: string,
	userQuery: string,
	assistantResponse: string,
): Promise<void> {
	// Store user message
	await createMessage({
		conversationId,
		role: "user",
		content: userQuery,
	});

	// Store assistant response
	await createMessage({
		conversationId,
		role: "assistant",
		content: assistantResponse,
	});
}

export const chatRoutes = {
	query: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query`,
			description:
				"Non-streaming query endpoint. Supports client-managed (messages array) or server-managed (conversationId) history.",
		})
		.input(queryBodySchema)
		.handler(async ({ input, context }) => {
			const { query, messages, conversationId, options } = input;

			// Resolve history mode
			const history = await resolveChatHistory({
				messages: messages as ChatMessage[] | undefined,
				conversationId,
				profileId: options?.profileId,
				userId: context.user.id,
			});

			const result = await queryRAG(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: options?.profileId,
				messages: history.messages,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			// Store messages if server-managed
			if (history.isServerManaged && history.conversationId) {
				await storeMessages(history.conversationId, query, result.answer);
			}

			return {
				...result,
				// Return conversationId for server-managed mode so caller can continue
				conversationId: history.conversationId,
			};
		}),

	search: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/search`,
			description: "Search chunks only (no LLM generation)",
		})
		.input(
			z.object({
				query: z.string().min(1).max(10000),
				options: queryOptionsSchema,
			}),
		)
		.handler(async ({ input }) => {
			const { query, options } = input;

			const results = await searchChunks(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			return { results };
		}),

	queryStream: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query/stream`,
			description:
				"Streaming query endpoint. Supports client-managed (messages array) or server-managed (conversationId) history.",
		})
		.input(queryBodySchema)
		.handler(async function* ({ input, context }) {
			const { query, messages, conversationId, options } = input;

			// Resolve history mode
			const history = await resolveChatHistory({
				messages: messages as ChatMessage[] | undefined,
				conversationId,
				profileId: options?.profileId,
				userId: context.user.id,
			});

			// Yield conversationId first for server-managed mode
			if (history.conversationId) {
				yield { type: "conversation_id", data: history.conversationId };
			}

			const stream = queryRAGStream(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: options?.profileId,
				messages: history.messages,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			// Collect full response for storage
			let fullResponse = "";

			for await (const chunk of stream) {
				yield chunk;

				// Accumulate tokens for storage
				if (chunk.type === "token") {
					fullResponse += chunk.data;
				}
			}

			// Store messages if server-managed
			if (history.isServerManaged && history.conversationId && fullResponse) {
				await storeMessages(history.conversationId, query, fullResponse);
			}
		}),

	getModels: publicProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/chat/models`,
			description: "Get available models",
		})
		.input(
			z.object({
				sortType: z.enum(["price", "contextLength"]).optional(),
				sortOrder: z.enum(["asc", "desc"]).optional(),
			}),
		)
		.output(
			z.object({
				models: z.array(
					z.object({
						id: z.string(),
						inputPrice: z.number(),
						outputPrice: z.number(),
						contextLength: z.number(),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
			const { sortType, sortOrder } = input;

			const models = OPENROUTER_AI_MODELS.map((model) => ({
				id: model.id,
				inputPrice: model.inputPrice,
				outputPrice: model.outputPrice,
				contextLength: model.contextLength,
			}));

			if (sortType && sortOrder) {
				models.sort((a, b) => {
					const valA =
						sortType === "price"
							? (a.inputPrice + a.outputPrice) / 2
							: a.contextLength;
					const valB =
						sortType === "price"
							? (b.inputPrice + b.outputPrice) / 2
							: b.contextLength;
					return sortOrder === "asc" ? valA - valB : valB - valA;
				});
			}

			return { models, sortType, sortOrder };
		}),
};
