import { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
	queryRAG,
	queryRAGStream,
	searchChunks,
	getDocument,
	type ChatMessage,
} from "../../services/rag.service";
import {
	createConversation,
	getConversation,
	listRecentMessages,
	createMessage,
} from "../../services/conversation.service";
import { estimateTokens } from "../../services/chunking.service";
import {
	CLIENT_MESSAGES_MAX_CHARS,
	CLIENT_MESSAGES_MAX_COUNT,
	HISTORY_MAX_MESSAGES,
	selectHistory,
} from "../../utils/history";
import { creditsProcedure, publicProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "@repo/llm/openrouter/models";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// Shared message schema. Clients cannot send `system` messages: that role is the server's.
const messageSchema = z.object({
	role: z.enum(["user", "assistant"]),
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
		query: z.string().trim().min(1).max(10000),
		// Client-managed mode: caller handles their own history.
		// Any array (even empty) selects this mode.
		messages: z
			.array(messageSchema)
			.max(CLIENT_MESSAGES_MAX_COUNT)
			.refine(
				(msgs) =>
					msgs.reduce((sum, m) => sum + m.content.length, 0) <=
					CLIENT_MESSAGES_MAX_CHARS,
				`Messages are too long (max ${CLIENT_MESSAGES_MAX_CHARS} characters in total)`,
			)
			.optional(),
		// Server-managed mode: we handle history storage
		conversationId: z.string().optional(),
		options: queryOptionsSchema,
	})
	.refine(
		(data) => !(data.messages !== undefined && data.conversationId),
		"Cannot provide both 'messages' and 'conversationId'. Choose one mode.",
	);

/**
 * Rejects a documentId filter that does not belong to the caller.
 */
async function assertOwnsDocument(
	documentId: string | undefined,
	userId: string,
): Promise<void> {
	if (!documentId) return;
	const doc = await getDocument(documentId, userId);
	if (!doc) {
		throw new ORPCError("NOT_FOUND", {
			message: "Document not found",
		});
	}
}

/**
 * Resolves chat history based on the provided mode.
 * A new server-managed conversation is NOT created here: it is created only
 * once an answer exists (see `persistExchange`), so failed requests leave nothing behind.
 */
async function resolveChatHistory(input: {
	messages?: ChatMessage[];
	conversationId?: string;
	profileId?: string;
	userId: string;
}): Promise<{
	messages: ChatMessage[];
	// Existing conversation id, null for client-managed mode and new conversations
	conversationId: string | null;
	// Profile to use: the request's, else the conversation's
	profileId: string | undefined;
	isServerManaged: boolean;
}> {
	// Mode 1: Client-managed - caller provides their own messages (possibly none)
	if (input.messages !== undefined) {
		return {
			messages: input.messages,
			conversationId: null,
			profileId: input.profileId,
			isServerManaged: false,
		};
	}

	// Mode 2: Server-managed, continuing an existing conversation
	if (input.conversationId) {
		const conv = await getConversation(input.conversationId, input.userId);
		if (!conv) {
			throw new ORPCError("NOT_FOUND", {
				message: "Conversation not found",
			});
		}

		// Newest turns, capped by count and tokens, replayed oldest first
		const recent = await listRecentMessages(
			input.conversationId,
			HISTORY_MAX_MESSAGES,
		);

		return {
			messages: selectHistory(recent, { countTokens: estimateTokens }),
			conversationId: input.conversationId,
			profileId: input.profileId ?? conv.profileId ?? undefined,
			isServerManaged: true,
		};
	}

	// Mode 2: New conversation, created after the first successful answer
	return {
		messages: [],
		conversationId: null,
		profileId: input.profileId,
		isServerManaged: true,
	};
}

/**
 * Stores the user query and assistant response, creating the conversation
 * first when this was the first exchange. Returns the conversation id.
 */
async function persistExchange(input: {
	conversationId: string | null;
	userId: string;
	profileId: string | undefined;
	userQuery: string;
	assistantResponse: string;
}): Promise<string> {
	const conversationId =
		input.conversationId ??
		(
			await createConversation({
				userId: input.userId,
				profileId: input.profileId ?? null,
				title: null,
			})
		).id;

	await createMessage({
		conversationId,
		role: "user",
		content: input.userQuery,
	});

	await createMessage({
		conversationId,
		role: "assistant",
		content: input.assistantResponse,
	});

	return conversationId;
}

export const chatRoutes = {
	query: creditsProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query`,
			description:
				"Non-streaming query endpoint. Supports client-managed (messages array) or server-managed (conversationId) history.",
		})
		.input(queryBodySchema)
		.handler(async ({ input, context }) => {
			const { query, messages, conversationId, options } = input;

			await assertOwnsDocument(options?.documentId, context.user.id);

			// Resolve history mode
			const history = await resolveChatHistory({
				messages,
				conversationId,
				profileId: options?.profileId,
				userId: context.user.id,
			});

			const result = await queryRAG(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: history.profileId,
				messages: history.messages,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
			});

			// Store the exchange if server-managed (creates the conversation on first use)
			const savedConversationId = history.isServerManaged
				? await persistExchange({
						conversationId: history.conversationId,
						userId: context.user.id,
						profileId: history.profileId,
						userQuery: query,
						assistantResponse: result.answer,
					})
				: null;

			return {
				...result,
				// Return conversationId for server-managed mode so caller can continue
				conversationId: savedConversationId,
			};
		}),

	search: creditsProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/search`,
			description: "Search chunks only (no LLM generation)",
		})
		.input(
			z.object({
				query: z.string().trim().min(1).max(10000),
				options: queryOptionsSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			const { query, options } = input;

			await assertOwnsDocument(options?.documentId, context.user.id);

			const results = await searchChunks(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: options?.profileId,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
			});

			return { results };
		}),

	queryStream: creditsProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query/stream`,
			description:
				"Streaming query endpoint. Supports client-managed (messages array) or server-managed (conversationId) history.",
		})
		.input(queryBodySchema)
		.handler(async function* ({ input, context }) {
			const { query, messages, conversationId, options } = input;

			await assertOwnsDocument(options?.documentId, context.user.id);

			// Resolve history mode
			const history = await resolveChatHistory({
				messages,
				conversationId,
				profileId: options?.profileId,
				userId: context.user.id,
			});

			// Existing conversation: announce its id first
			if (history.conversationId) {
				yield { type: "conversation_id", data: history.conversationId };
			}

			const stream = queryRAGStream(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: history.profileId,
				messages: history.messages,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
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

			// Store the exchange only after a complete answer. A new conversation is
			// created now, so its id is announced at the end of the stream.
			if (history.isServerManaged && fullResponse) {
				const savedConversationId = await persistExchange({
					conversationId: history.conversationId,
					userId: context.user.id,
					profileId: history.profileId,
					userQuery: query,
					assistantResponse: fullResponse,
				});
				if (!history.conversationId) {
					yield { type: "conversation_id", data: savedConversationId };
				}
			}
		}),

	getModels: publicProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/chat/models`,
			description:
				"Get available models. Use `type=embedding` to fetch embedding models, defaults to `chat`.",
		})
		.input(
			z.object({
				type: z.enum(["chat", "embedding"]).optional().default("chat"),
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
						dimensions: z.number().optional(),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
			const { type, sortType, sortOrder } = input;

			const models =
				type === "embedding"
					? OPENROUTER_EMBEDDING_MODELS.map((model) => ({
							id: model.id,
							inputPrice: model.inputPrice,
							outputPrice: model.outputPrice,
							contextLength: model.contextLength,
							dimensions: model.dimensions,
						}))
					: OPENROUTER_AI_MODELS.map((model) => ({
							id: model.id,
							inputPrice: model.inputPrice,
							outputPrice: model.outputPrice,
							contextLength: model.contextLength,
							dimensions: undefined,
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

			return { models };
		}),
};
