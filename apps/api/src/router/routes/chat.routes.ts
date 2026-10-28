import { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
	queryRAG,
	queryRAGStream,
	continueRAG,
	continueRAGStream,
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
import { resolveKnowledgeBase } from "../access";
import { queryOptionsSchema } from "../../utils/chat_options";
import {
	MAX_TOOL_RESULTS,
	TOOL_CALL_ID_MAX_CHARS,
	TOOL_RESULT_MAX_CHARS,
	type TurnConversation,
	type TurnOutcome,
} from "../../services/chat-tools.service";
import { env } from "../../config/env";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { listChatModels } from "../../services/model-catalog.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// Shared message schema. Clients cannot send `system` messages: that role is the server's.
const messageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});

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

// Results of the tool calls a stream (or response) ended with
const continueBodySchema = z.object({
	continuationId: z.string().min(1).max(200),
	toolResults: z
		.array(
			z.object({
				toolCallId: z.string().min(1).max(TOOL_CALL_ID_MAX_CHARS),
				content: z.string().max(TOOL_RESULT_MAX_CHARS),
			}),
		)
		.min(1)
		.max(MAX_TOOL_RESULTS),
});

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

/**
 * Stores a finished turn of a server-managed conversation. A turn that ended
 * in tool calls stores nothing yet (its continuation carries the conversation),
 * and tool messages are never stored. Returns the conversation id, or null.
 */
async function persistOutcome(
	outcome: TurnOutcome,
	userId: string,
	apiKeyId: string | null,
): Promise<string | null> {
	const { conversation } = outcome;
	if (!conversation.serverManaged || outcome.finishReason !== "stop" || !outcome.answer) {
		return null;
	}
	return persistExchange({
		conversationId: conversation.conversationId,
		userId,
		profileId: conversation.profileId ?? undefined,
		apiKeyId,
		userQuery: conversation.userQuery,
		assistantResponse: outcome.answer,
	});
}

const turnConversation = (
	history: { isServerManaged: boolean; conversationId: string | null; profileId: string | undefined },
	query: string,
): TurnConversation => ({
	serverManaged: history.isServerManaged,
	conversationId: history.conversationId,
	profileId: history.profileId ?? null,
	userQuery: query,
});

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
					excludeSourcePrefixes: options?.excludeSourcePrefixes,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
				strictProfile: Boolean(context.apiKeyProfileId),
				apiKeyId: context.apiKeyId,
				apiKeyProfileId: context.apiKeyProfileId,
				conversation: turnConversation(history, query),
			});

			// Store the exchange if server-managed (creates the conversation on first use)
			const savedConversationId = await persistOutcome(
				{
					finishReason: result.finishReason,
					answer: result.answer,
					conversation: turnConversation(history, query),
				},
				context.user.id,
				context.apiKeyId,
			);

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
					excludeSourcePrefixes: options?.excludeSourcePrefixes,
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
				yield { type: "conversation_id" as const, data: history.conversationId };
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
					excludeSourcePrefixes: options?.excludeSourcePrefixes,
				},
				organizationId: context.organizationId,
				userId: context.user.id,
				strictProfile: Boolean(context.apiKeyProfileId),
				apiKeyId: context.apiKeyId,
				apiKeyProfileId: context.apiKeyProfileId,
				conversation: turnConversation(history, query),
			});

			const outcome = yield* stream;

			// Store the exchange only after a complete answer. A new conversation is
			// created now, so its id is announced at the end of the stream.
			const savedConversationId = await persistOutcome(
				outcome,
				context.user.id,
				context.apiKeyId,
			);
			yield { type: "done" as const, data: { finishReason: outcome.finishReason } };
			if (savedConversationId && !history.conversationId) {
				yield { type: "conversation_id" as const, data: savedConversationId };
			}
		}),

	continue: chatProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/continue`,
			description:
				"Send the results of the tool calls a /chat/query response asked for. Same response as /chat/query; it may ask for tool calls again.",
		})
		.input(continueBodySchema)
		.handler(async ({ input, context }) => {
			const { result, outcome } = await continueRAG(
				input.continuationId,
				input.toolResults,
				{
					organizationId: context.organizationId,
					userId: context.user.id,
					apiKeyId: context.apiKeyId,
					apiKeyProfileId: context.apiKeyProfileId,
				},
			);
			const savedConversationId = await persistOutcome(
				outcome,
				context.user.id,
				context.apiKeyId,
			);
			return {
				...result,
				conversationId: savedConversationId ?? outcome.conversation.conversationId,
			};
		}),

	continueStream: chatProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/continue/stream`,
			description:
				"Streaming variant of /chat/continue: sources, tokens, tool_calls (when another round is needed), usage, done.",
		})
		.input(continueBodySchema)
		.handler(async function* ({ input, context }) {
			const outcome = yield* continueRAGStream(
				input.continuationId,
				input.toolResults,
				{
					organizationId: context.organizationId,
					userId: context.user.id,
					apiKeyId: context.apiKeyId,
					apiKeyProfileId: context.apiKeyProfileId,
				},
			);
			const savedConversationId = await persistOutcome(
				outcome,
				context.user.id,
				context.apiKeyId,
			);
			yield { type: "done" as const, data: { finishReason: outcome.finishReason } };
			// The turn's conversation, once its exchange is stored
			if (savedConversationId) {
				yield { type: "conversation_id" as const, data: savedConversationId };
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
