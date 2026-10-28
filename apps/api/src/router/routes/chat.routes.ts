import { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
	queryRAG,
	queryRAGStream,
	searchChunks,
	getDocument,
	isDocumentInProfile,
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
import { chatProcedure, publicProcedure } from "../middleware";
import { env } from "../../config/env";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { listChatModels } from "../../services/model-catalog.service";

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
		// Only documents whose source starts with this, e.g. "https://example.com/en/"
		sourcePrefix: z.string().min(1).max(512).optional(),
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
 * Knowledge base (profile) for a request. A key bound to one knowledge base
 * always uses it and cannot name another; other callers choose freely (and
 * their profile ownership is checked when it is loaded).
 */
function resolveKnowledgeBase(
	requestedProfileId: string | undefined,
	apiKeyProfileId: string | null,
): string | undefined {
	if (!apiKeyProfileId) return requestedProfileId;
	if (requestedProfileId && requestedProfileId !== apiKeyProfileId) {
		throw new ORPCError("FORBIDDEN", {
			message: "This API key is limited to another knowledge base",
		});
	}
	return apiKeyProfileId;
}

/**
 * Rejects a documentId filter that does not belong to the caller, or (for a
 * key bound to one knowledge base) to that knowledge base.
 */
async function assertOwnsDocument(
	documentId: string | undefined,
	userId: string,
	apiKeyProfileId: string | null,
): Promise<void> {
	if (!documentId) return;
	const found = apiKeyProfileId
		? await isDocumentInProfile(documentId, apiKeyProfileId, userId)
		: Boolean(await getDocument(documentId, userId));
	if (!found) {
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
	/**
	 * Set for keys bound to one knowledge base: such a key only continues the
	 * conversations it created itself, never the owner's own chats.
	 */
	apiKeyProfileId: string | null;
	apiKeyId: string | null;
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
		const createdByThisKey =
			conv?.profileId === input.apiKeyProfileId &&
			(conv?.metadata as { apiKeyId?: unknown } | null)?.apiKeyId ===
				input.apiKeyId;
		if (!conv || (input.apiKeyProfileId && !createdByThisKey)) {
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
	// API key that started the conversation (lets a chat-only key continue it)
	apiKeyId: string | null;
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
				metadata: input.apiKeyId ? { apiKeyId: input.apiKeyId } : {},
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
	query: chatProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query`,
			description:
				"Non-streaming query endpoint. Supports client-managed (messages array) or server-managed (conversationId) history.",
		})
		.input(queryBodySchema)
		.handler(async ({ input, context }) => {
			const { query, messages, conversationId, options } = input;

			const profileId = resolveKnowledgeBase(
				options?.profileId,
				context.apiKeyProfileId,
			);
			await assertOwnsDocument(
				options?.documentId,
				context.user.id,
				context.apiKeyProfileId,
			);

			// Resolve history mode
			const history = await resolveChatHistory({
				messages,
				conversationId,
				profileId,
				userId: context.user.id,
				apiKeyProfileId: context.apiKeyProfileId,
				apiKeyId: context.apiKeyId,
			});

			const result = await queryRAG(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: history.profileId,
				messages: history.messages,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
					sourcePrefix: options?.sourcePrefix,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
				strictProfile: Boolean(context.apiKeyProfileId),
			});

			// Store the exchange if server-managed (creates the conversation on first use)
			const savedConversationId = history.isServerManaged
				? await persistExchange({
						conversationId: history.conversationId,
						userId: context.user.id,
						profileId: history.profileId,
						apiKeyId: context.apiKeyId,
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

	search: chatProcedure
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

			await assertOwnsDocument(
				options?.documentId,
				context.user.id,
				context.apiKeyProfileId,
			);

			const results = await searchChunks(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				profileId: resolveKnowledgeBase(
					options?.profileId,
					context.apiKeyProfileId,
				),
				filter: {
					documentId: options?.documentId,
					source: options?.source,
					sourcePrefix: options?.sourcePrefix,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
				strictProfile: Boolean(context.apiKeyProfileId),
			});

			return { results };
		}),

	queryStream: chatProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query/stream`,
			description:
				"Streaming query endpoint. Supports client-managed (messages array) or server-managed (conversationId) history.",
		})
		.input(queryBodySchema)
		.handler(async function* ({ input, context }) {
			const { query, messages, conversationId, options } = input;

			const profileId = resolveKnowledgeBase(
				options?.profileId,
				context.apiKeyProfileId,
			);
			await assertOwnsDocument(
				options?.documentId,
				context.user.id,
				context.apiKeyProfileId,
			);

			// Resolve history mode
			const history = await resolveChatHistory({
				messages,
				conversationId,
				profileId,
				userId: context.user.id,
				apiKeyProfileId: context.apiKeyProfileId,
				apiKeyId: context.apiKeyId,
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
					sourcePrefix: options?.sourcePrefix,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
				strictProfile: Boolean(context.apiKeyProfileId),
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
					apiKeyId: context.apiKeyId,
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
				"Get available models. Use `type=embedding` to fetch embedding models, defaults to `chat`. Chat models are the current OpenRouter list, newest first; prices are USD per 1M tokens.",
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
						name: z.string(),
						// Unix seconds; 0 when the model comes from the static list
						created: z.number(),
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

			// Chat models come newest first from the catalog
			const models =
				type === "embedding"
					? OPENROUTER_EMBEDDING_MODELS.map((model) => ({
							id: model.id,
							name: model.id,
							created: 0,
							inputPrice: model.inputPrice,
							outputPrice: model.outputPrice,
							contextLength: model.contextLength,
							dimensions: model.dimensions,
						}))
					: listChatModels().map((model) => ({
							id: model.id,
							name: model.name,
							created: model.created,
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
