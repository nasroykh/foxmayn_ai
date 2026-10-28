import { randomUUID } from "node:crypto";
import { db, document } from "@repo/db";
import { searchVectors } from "@repo/qdrant";
import {
	eq,
	and,
	inArray,
	desc,
	count,
} from "@repo/db/drizzle-orm";
import {
	OpenRouterQuery,
	OpenRouterToolTurn,
	DEFAULT_EMBEDDING_MODEL,
	OpenRouterEmbed,
	type AIUsage,
} from "@repo/llm/openrouter";
import { ORPCError } from "@orpc/server";
import { describeError } from "../config/redact";
import {
	requireAnswer,
	requireStreamedAnswer,
	toChatProviderError,
} from "../utils/provider-error";
import { getProfile, getDefaultProfile } from "./profile.service";
import {
	addIndexDocumentJob,
	addDeleteDocumentJob,
	addReindexDocumentJob,
} from "../jobs";
import { parseDocx, parseHTML, parsePDF } from "../utils/parsers";
import {
	DOCX_MIME,
	MAX_DOCX_UNCOMPRESSED_BYTES,
	MAX_EXTRACTED_CHARS,
	MAX_FILE_SIZE,
	zipInflatesWithin,
	isAllowedFileType,
	matchesFileSignature,
	zipDeclaredUncompressedSize,
	ALLOWED_FILE_TYPES,
} from "../utils/file_validation";
import { fetchUrlAsFile } from "../utils/url_fetch";
import { buildSystemPrompt } from "../utils/system_prompts";
import { qdrant, ensureCollection, type VectorPayload } from "./qdrant.shared";
import { buildChunkFilter } from "./qdrant.filter";
import {
	profileDocumentsFilter,
	searchableDocumentsFilter,
} from "./document.filter";
import { logUsageAndDeduct, recordUsage } from "./usage.service";
import {
	reserveCredits,
	settleReservation,
	type CreditReservation,
} from "./credits.service";
import {
	estimateChatCost,
	isKnownChatModel,
	resolveChatCost,
	CREDIT_EPSILON,
} from "../utils/cost";
import { buildRetrievalQuery } from "../utils/history";
import { DEFAULT_CHAT_MODEL } from "./model-catalog.service";
import {
	DEFAULT_MAX_TOKENS,
	DEFAULT_REASONING_EFFORT,
} from "../utils/profile_schema";
import { estimateTokens } from "./chunking.service";
import { redis } from "../config/redis";
import { enabledTools, type ToolSpec } from "../utils/profile_tools";
import {
	continuationRef,
	continueToolTurn,
	runToolLoop,
	saveContinuation,
	type CallOutcome,
	type ContinuationCaller,
	type ModelSettings,
	type ToolLoopDeps,
	type ToolLoopEvent,
	type ToolResult,
	type ToolTurnState,
	type TurnConversation,
	type TurnOutcome,
} from "./chat-tools.service";

// Per-message framing overhead of chat formats, in tokens
const MESSAGE_OVERHEAD_TOKENS = 4;
// How long to wait for the provider to report usage after a stream ended
const USAGE_TIMEOUT_MS = 15_000;

type ReasoningEffort = NonNullable<
	Parameters<typeof OpenRouterQuery>[0]["reasoning"]
>;

// Types
export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export interface QueryOptions {
	limit?: number;
	scoreThreshold?: number;
	profileId?: string;
	messages?: ChatMessage[];
	filter?: {
		documentId?: string;
		source?: string;
		// Only documents whose source starts with this
		sourcePrefix?: string;
		// Never documents whose source starts with one of these
		excludeSourcePrefixes?: string[];
	};
	// Organization billed for the call
	organizationId: string;
	// Owner of the documents to search (mandatory: retrieval is always scoped to it)
	userId: string;
	// Chat-only API key: only documents explicitly in the profile, never the
	// profile-less ones the default profile otherwise includes
	strictProfile?: boolean;
}

/** A chat request: who asks (for a tool continuation) and where the exchange is stored. */
export interface ChatOptions extends QueryOptions {
	apiKeyId: string | null;
	// Set for chat-only keys (bound to one knowledge base)
	apiKeyProfileId: string | null;
	conversation: TurnConversation;
}

export interface QueryResult {
	answer: string;
	sources: SearchResult[];
	usage?: AIUsage;
	finishReason: "stop" | "tool_calls";
	toolCalls?: Extract<ToolLoopEvent, { type: "tool_calls" }>["data"]["calls"];
	continuationId?: string;
	expiresAt?: string;
}

export type ChatStreamEvent =
	| { type: "sources"; data: SearchResult[] }
	| ToolLoopEvent;

export interface SearchResult {
	documentId: string;
	chunkId: string;
	content: string;
	score: number;
	// Of the document, so a caller can cite it without another request
	title: string;
	source: string | null;
}

type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

// Everything except `content`, which can be megabytes
const documentSummaryColumns = {
	id: document.id,
	userId: document.userId,
	profileId: document.profileId,
	title: document.title,
	source: document.source,
	embeddingModel: document.embeddingModel,
	metadata: document.metadata,
	status: document.status,
	chunkCount: document.chunkCount,
	createdAt: document.createdAt,
	updatedAt: document.updatedAt,
};

// ============================================================================
// Documents
// ============================================================================

/**
 * Validate an upload and extract its text.
 * Checks type allowlist, size, file signature, and bounds the extracted text.
 * Throws BAD_REQUEST for anything unacceptable.
 */
export const extractTextFromDocument = async (file: File): Promise<string> => {
	if (!file || !file.name || !file.type)
		throw new ORPCError("BAD_REQUEST", {
			message: "File is required",
		});

	if (!isAllowedFileType(file.type))
		throw new ORPCError("BAD_REQUEST", {
			message: "Invalid file type.",
			data: {
				allowedFileTypes: ALLOWED_FILE_TYPES,
			},
		});

	if (file.size > MAX_FILE_SIZE)
		throw new ORPCError("BAD_REQUEST", {
			message: "File too large (max 10MB)",
		});

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.length > MAX_FILE_SIZE)
		throw new ORPCError("BAD_REQUEST", {
			message: "File too large (max 10MB)",
		});

	if (!matchesFileSignature(file.type, bytes))
		throw new ORPCError("BAD_REQUEST", {
			message: "File content does not match its type",
		});

	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	let text: string;
	try {
		switch (file.type) {
			case "text/html":
				text = parseHTML(buffer.toString("utf-8"));
				break;
			case "application/pdf":
				text = await parsePDF(buffer);
				break;
			case DOCX_MIME: {
				const declared = zipDeclaredUncompressedSize(bytes);
				// Declared sizes are cheap to check but attacker controlled: also inflate
				// with a hard cap before JSZip (inside mammoth) inflates without one
				if (
					declared === null ||
					declared > MAX_DOCX_UNCOMPRESSED_BYTES ||
					!zipInflatesWithin(bytes, MAX_DOCX_UNCOMPRESSED_BYTES)
				)
					throw new ORPCError("BAD_REQUEST", {
						message: "DOCX file is invalid or too large once unpacked",
					});
				text = await parseDocx(buffer);
				break;
			}
			default:
				text = buffer.toString("utf-8");
		}
	} catch (err) {
		if (err instanceof ORPCError) throw err;
		console.error("[RAG] Failed to parse upload:", describeError(err));
		throw new ORPCError("BAD_REQUEST", {
			message: "Could not read the file. It may be corrupt.",
		});
	}

	if (text.length > MAX_EXTRACTED_CHARS)
		throw new ORPCError("BAD_REQUEST", {
			message: `Document text is too long (max ${MAX_EXTRACTED_CHARS.toLocaleString("en-US")} characters)`,
		});

	return text;
};

/**
 * Create the document row and queue its indexing. Shared by the file upload
 * and the import path. The caller has already extracted `content` and checked
 * that `profileId` belongs to the owner.
 */
const createAndQueueDocument = async (options: {
	content: string;
	title: string;
	source?: string;
	profileId?: string;
	metadata?: Record<string, unknown>;
	replaceSource?: boolean;
	userId: string;
	organizationId: string;
}): Promise<{ documentId: string; jobId: string | undefined }> => {
	const {
		content,
		title,
		source,
		profileId,
		metadata,
		replaceSource,
		userId,
		organizationId,
	} = options;

	if (!content.trim())
		throw new ORPCError("BAD_REQUEST", {
			message: "File is empty",
		});

	const documentId = randomUUID();

	// A document without a profile goes to the current default profile, so it
	// belongs to one knowledge base explicitly (a chat-only key only reads those)
	const resolvedProfileId =
		profileId ?? (await getDefaultProfile(userId))?.id ?? undefined;

	// Create document record with status "processing"
	await db.insert(document).values({
		id: documentId,
		userId,
		profileId: resolvedProfileId,
		title,
		content,
		source,
		metadata,
		status: "processing",
	});

	// Add job to queue - returns immediately. The worker reads the content from the row.
	try {
		const { jobId } = await addIndexDocumentJob({
			documentId,
			profileId: resolvedProfileId,
			organizationId,
			userId,
			replaceSource,
		});
		return { documentId, jobId };
	} catch (err) {
		// Without a job the document would stay "processing" forever
		await db.delete(document).where(eq(document.id, documentId));
		throw err;
	}
};

/**
 * Index a document into the RAG system (ASYNC - via background job)
 *
 * This returns immediately with a jobId. The actual indexing
 * happens in a background worker process.
 *
 * @returns documentId and jobId for tracking
 */
export const indexDocument = async (options: {
	file: File;
	title?: string;
	source?: string;
	profileId?: string;
	metadata?: Record<string, unknown>;
	userId: string;
	organizationId: string;
}): Promise<{ documentId: string; jobId: string | undefined }> => {
	const { file, title, ...rest } = options;

	// The profile id is stored as-is: it must belong to the caller. Checked
	// before parsing so a bad id costs nothing.
	if (rest.profileId) await loadProfile(rest.profileId, rest.userId);

	const content = await extractTextFromDocument(file);

	return createAndQueueDocument({
		...rest,
		content,
		title: title || file.name || "Untitled",
	});
};

const MAX_DERIVED_TITLE_CHARS = 120;

/**
 * Create a document from raw text or from a URL (ASYNC - via background job).
 * With `replace`, older documents of the same owner, source and profile are
 * deleted by the worker once this one is indexed, so the knowledge base is
 * never empty in between.
 * The caller guarantees exactly one of `text` and `url`, and a `source` when `replace` is set.
 */
export const importDocument = async (options: {
	text?: string;
	url?: string;
	title?: string;
	source?: string;
	profileId?: string;
	metadata?: Record<string, unknown>;
	replace?: boolean;
	userId: string;
	organizationId: string;
}): Promise<{ documentId: string; jobId: string | undefined }> => {
	const { text, url, title, source, replace, ...rest } = options;

	// The profile id is stored as-is: it must belong to the caller. Checked
	// before any fetch so a bad id costs nothing.
	if (rest.profileId) await loadProfile(rest.profileId, rest.userId);

	let content: string;
	let defaultTitle: string;
	if (url !== undefined) {
		const file = await fetchUrlAsFile(url);
		content = await extractTextFromDocument(file);
		defaultTitle = file.name;
	} else {
		content = text ?? "";
		if (!content.trim())
			throw new ORPCError("BAD_REQUEST", { message: "Text is empty" });
		if (content.length > MAX_EXTRACTED_CHARS)
			throw new ORPCError("BAD_REQUEST", {
				message: `Document text is too long (max ${MAX_EXTRACTED_CHARS.toLocaleString("en-US")} characters)`,
			});
		defaultTitle = content
			.trim()
			.split(/\r?\n/)[0]
			.trim()
			.slice(0, MAX_DERIVED_TITLE_CHARS);
	}

	return createAndQueueDocument({
		...rest,
		content,
		title: title || defaultTitle || "Untitled",
		source: source ?? url,
		replaceSource: replace,
	});
};

/**
 * Delete a document and its vectors (ASYNC - via background job).
 * The caller must have verified ownership.
 */
export const deleteDocument = async (
	documentId: string,
	userId: string,
): Promise<{ jobId: string | undefined }> => {
	const { jobId } = await addDeleteDocumentJob({ documentId, userId });
	return { jobId };
};

/**
 * Documents that follow a profile (those without a profile follow the default).
 * `strict` keeps only documents explicitly in the profile: a document loses its
 * profile when that profile is deleted, and must not join what a chat-only key
 * bound to the default profile can read.
 */
/** Number of documents a re-index of this profile would process. */
export const countProfileDocuments = async (
	profile: { id: string; isDefault: boolean },
	userId: string,
): Promise<number> => {
	const [row] = await db
		.select({ count: count() })
		.from(document)
		.where(profileDocumentsFilter(profile, userId));
	return row?.count ?? 0;
};

/**
 * Re-index every document of a profile (after its embedding model changed).
 * Documents without a profile belong to the user's default profile.
 * Billed to `organizationId` like any other indexing.
 */
export const reindexProfileDocuments = async (
	profile: { id: string; isDefault: boolean },
	userId: string,
	organizationId: string,
): Promise<{ count: number }> => {
	const docs = await db
		.select({ id: document.id })
		.from(document)
		.where(profileDocumentsFilter(profile, userId));

	if (docs.length === 0) return { count: 0 };

	const ids = docs.map((d) => d.id);
	await db
		.update(document)
		.set({ status: "processing" })
		.where(inArray(document.id, ids));

	await Promise.all(
		ids.map((documentId) =>
			addReindexDocumentJob({
				documentId,
				profileId: profile.id,
				organizationId,
				userId,
			}),
		),
	);

	return { count: ids.length };
};

/**
 * Get document by ID (scoped to user). Never selects the document text.
 */
export const getDocument = async (documentId: string, userId: string) => {
	const [doc] = await db
		.select(documentSummaryColumns)
		.from(document)
		.where(and(eq(document.id, documentId), eq(document.userId, userId)));

	return doc || null;
};

/**
 * List documents (scoped to user). Never selects the document text.
 */
export const listDocuments = async (
	limit: number,
	offset: number,
	userId: string,
) => {
	return await db
		.select(documentSummaryColumns)
		.from(document)
		.where(eq(document.userId, userId))
		.orderBy(desc(document.createdAt))
		.limit(limit)
		.offset(offset);
};

/**
 * Count total documents (scoped to user)
 */
export const countDocuments = async (userId: string) => {
	const [result] = await db
		.select({ count: count() })
		.from(document)
		.where(eq(document.userId, userId));
	return result?.count ?? 0;
};

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Load the profile for a request. An explicit profile id must belong to the
 * caller; without one the caller's default profile is used (or null).
 */
const loadProfile = async (
	profileId: string | undefined,
	userId: string,
): Promise<Profile | null> => {
	if (profileId) {
		const profile = await getProfile(profileId, userId);
		if (!profile)
			throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
		return profile;
	}
	return await getDefaultProfile(userId);
};

/**
 * Search the caller's documents with an already loaded profile.
 * Logs embedding usage and bills it to the organization.
 */
const searchWithProfile = async (
	query: string,
	profile: Profile | null,
	options: QueryOptions,
): Promise<SearchResult[]> => {
	const { filter, organizationId, userId } = options;

	const embeddingModelId = profile?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
	const limit = options.limit ?? profile?.topK ?? 5;
	const scoreThreshold =
		options.scoreThreshold ?? profile?.scoreThreshold ?? 0.3;

	// Throws BAD_REQUEST for a model that is not in the supported list
	const collectionName = await ensureCollection(embeddingModelId);

	// Documents searchable with this model. A profile is a knowledge base: only
	// its documents are searched (those without a profile follow the default one).
	// A browser session naming one of its documents searches that document,
	// whatever its profile (the route checked ownership).
	// Documents indexed with another embedding model live in another collection.
	const scopeToProfile =
		profile !== null && (options.strictProfile || !filter?.documentId);
	// Source prefixes narrow that set further (e.g. one language of a site,
	// minus one of its regions)
	const narrowsBySource = Boolean(
		filter?.sourcePrefix || filter?.excludeSourcePrefixes?.length,
	);
	const searchable = await db
		.select({ id: document.id, title: document.title, source: document.source })
		.from(document)
		.where(
			searchableDocumentsFilter({
				userId,
				embeddingModel: embeddingModelId,
				profile: scopeToProfile ? profile : null,
				strictProfile: options.strictProfile,
				documentId: filter?.documentId,
				sourcePrefix: filter?.sourcePrefix,
				excludeSourcePrefixes: filter?.excludeSourcePrefixes,
			}),
		);
	// Early exit: nothing indexed here yet, skip the embedding API call
	if (searchable.length === 0) return [];

	const { embeddings, usage: embedUsage } = await OpenRouterEmbed(
		embeddingModelId,
		[query],
	);

	// The embedding is already paid for: always collect it
	await logUsageAndDeduct({
		organizationId,
		userId,
		operationType: "embedding",
		model: embeddingModelId,
		// Providers occasionally omit usage: fall back to our own count
		inputTokens: embedUsage.totalTokens || estimateTokens(query),
		outputTokens: 0,
		metadata: { context: "search_query" },
	});

	// Build filter (always scoped to the owner)
	const qdrantFilter = buildChunkFilter({
		userId,
		documentId: filter?.documentId,
		documentIds:
			scopeToProfile || narrowsBySource
				? searchable.map((d) => d.id)
				: undefined,
		source: filter?.source,
	});

	const results = await searchVectors(qdrant, collectionName, embeddings[0], {
		limit,
		scoreThreshold,
		filter: qdrantFilter,
	});

	const documents = new Map(searchable.map((d) => [d.id, d]));
	return results.map((r) => {
		const payload = r.payload as unknown as VectorPayload;
		const doc = documents.get(payload.documentId);
		return {
			documentId: payload.documentId,
			chunkId: payload.chunkId,
			content: payload.content,
			score: r.score,
			title: doc?.title ?? "",
			source: doc?.source ?? null,
		};
	});
};

/**
 * Search for relevant chunks (no LLM generation).
 */
export const searchChunks = async (
	query: string,
	options: QueryOptions,
): Promise<SearchResult[]> => {
	const profile = await loadProfile(options.profileId, options.userId);
	return searchWithProfile(query, profile, options);
};

/** True when the document is explicitly in the knowledge base (profile) of `userId`. */
export const isDocumentInProfile = async (
	documentId: string,
	profileId: string,
	userId: string,
): Promise<boolean> => {
	const profile = await getProfile(profileId, userId);
	if (!profile) return false;
	const [row] = await db
		.select({ id: document.id })
		.from(document)
		.where(
			and(eq(document.id, documentId), profileDocumentsFilter(profile, userId, true)),
		)
		.limit(1);
	return Boolean(row);
};

// ============================================================================
// Chat
// ============================================================================

interface ChatContext {
	settings: ModelSettings;
	systemPrompt: string;
	messages: ChatMessage[];
	sources: SearchResult[];
	// Enabled tools of the profile; none means a plain chat call
	tools: ToolSpec[];
	profileId: string | null;
}

/** What one model call reserved; settled by `settleChat`. */
interface ChatCharge {
	modelId: string;
	promptTokens: number;
	reservation: CreditReservation;
	usageId: string;
}

/**
 * Everything both chat paths share: load the profile, retrieve context and
 * build the one system prompt. Retrieval runs once per user turn.
 */
const prepareChat = async (
	query: string,
	options: QueryOptions,
): Promise<ChatContext> => {
	const profile = await loadProfile(options.profileId, options.userId);

	const modelId = profile?.model ?? DEFAULT_CHAT_MODEL;
	if (!isKnownChatModel(modelId))
		throw new ORPCError("BAD_REQUEST", {
			message: `Unsupported model: ${modelId}`,
		});

	const messages = options.messages ?? [];

	// A follow-up is searched together with the previous question
	const sources = await searchWithProfile(
		buildRetrievalQuery(query, messages),
		profile,
		options,
	);

	const context = sources.map((r, i) => `[${i + 1}] ${r.content}`).join("\n\n");

	return {
		settings: {
			modelId,
			maxTokens: profile?.maxTokens ?? DEFAULT_MAX_TOKENS,
			temperature: profile?.temperature ?? 1.0,
			topP: profile?.topP,
			reasoning: profile?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
		},
		systemPrompt: buildSystemPrompt(profile, context),
		messages,
		sources,
		tools: enabledTools(profile?.tools),
		profileId: profile?.id ?? null,
	};
};

/** Tokens of the full prompt of a plain chat call. */
const plainPromptTokens = (context: ChatContext, query: string): number =>
	estimateTokens(context.systemPrompt) +
	estimateTokens(query) +
	context.messages.reduce(
		(sum, m) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD_TOKENS,
		0,
	) +
	2 * MESSAGE_OVERHEAD_TOKENS;

/**
 * Reserve the worst-case cost of one model call.
 * Throws FORBIDDEN (before any LLM spend) when the balance cannot cover it.
 */
const reserveChat = async (
	settings: ModelSettings,
	promptTokens: number,
	options: { organizationId: string; userId: string },
): Promise<ChatCharge> => {
	const { modelId } = settings;
	const estimatedCost = Math.max(
		estimateChatCost(modelId, promptTokens, settings.maxTokens),
		CREDIT_EPSILON,
	);

	const usageId = randomUUID();
	const reservation = await reserveCredits({
		orgId: options.organizationId,
		userId: options.userId,
		amount: estimatedCost,
		description: `chat reservation — ${modelId}`,
		referenceId: usageId,
	});

	return { modelId, promptTokens, reservation, usageId };
};

/**
 * Turn the reservation into the real cost and log it. Always runs (from a
 * `finally`), so errors and client disconnects are billed too:
 * - provider rejected the request or never answered: full refund
 * - usage reported: actual cost (a shortfall is collected even below zero balance)
 * - usage missing after a call: the reserved estimate is charged
 * Never throws; billing problems are logged for reconciliation.
 */
const settleChat = async (input: {
	charge: ChatCharge;
	options: { organizationId: string; userId: string };
	providerCalled: boolean;
	usage: AIUsage | null;
	context: string;
	metadata?: Record<string, unknown>;
}): Promise<void> => {
	const { charge, options, providerCalled, usage, context } = input;
	const { modelId, reservation, usageId } = charge;

	let cost = 0;
	let usageKnown = false;
	if (providerCalled) {
		try {
			({ cost, usageKnown } = resolveChatCost({
				modelId,
				usage,
				reservedAmount: reservation.amount,
			}));
		} catch (err) {
			// E.g. the model left the pricing list mid-request: charge the reservation
			console.error(`[Usage] Could not price chat ${modelId}:`, describeError(err));
			cost = reservation.amount;
		}
	}

	try {
		await settleReservation(reservation, cost, `chat ${modelId}`, usageId);
	} catch (err) {
		console.error(
			`[Usage] SETTLEMENT FAILED (org ${options.organizationId}, usage ${usageId}, reserved ${reservation.amount}, actual ${cost}):`,
			describeError(err),
		);
	}

	if (!providerCalled) return;

	await recordUsage({
		id: usageId,
		organizationId: options.organizationId,
		userId: options.userId,
		operationType: "chat",
		model: modelId,
		inputTokens: usageKnown && usage ? usage.inputTokens : charge.promptTokens,
		outputTokens: usageKnown && usage ? usage.outputTokens : 0,
		costCredits: cost,
		metadata: { context, usageEstimated: !usageKnown, ...input.metadata },
	});
};

/**
 * Ask the provider for usage after a stream ended, without waiting forever.
 * Returns null when unavailable.
 */
const fetchStreamUsage = async (
	getUsage: (() => Promise<AIUsage>) | null,
): Promise<AIUsage | null> => {
	if (!getUsage) return null;
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			getUsage(),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), USAGE_TIMEOUT_MS);
			}),
		]);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
};

// ============================================================================
// Chat with tools
// ============================================================================

/** Provider, billing and Redis for the tool loop. */
const toolLoopDeps = (
	options: { organizationId: string; userId: string },
	context: string,
): ToolLoopDeps<ChatCharge> => ({
	callModel: (settings, input, tools, toolChoice) =>
		OpenRouterToolTurn(
			{
				model: settings.modelId,
				temperature: settings.temperature,
				topP: settings.topP,
				maxTokens: settings.maxTokens,
				reasoning: settings.reasoning as ReasoningEffort,
			},
			input,
			tools,
			toolChoice,
		),
	reserve: (settings, promptTokens) => reserveChat(settings, promptTokens, options),
	settle: (charge, outcome: CallOutcome) =>
		settleChat({
			charge,
			options,
			providerCalled: outcome.providerCalled,
			usage: outcome.usage,
			context,
			metadata: {
				round: outcome.round,
				// A hash: the id itself is a bearer secret while it lives
				continuationId:
					outcome.continuationId && continuationRef(outcome.continuationId),
			},
		}),
	saveContinuation: (state) => saveContinuation(redis, state),
	countTokens: estimateTokens,
});

/** State of a new tool turn: the one system prompt, the history and the query. */
const startToolTurn = (
	query: string,
	context: ChatContext,
	options: ChatOptions,
): ToolTurnState<SearchResult> => ({
	binding: {
		organizationId: options.organizationId,
		userId: options.userId,
		apiKeyId: options.apiKeyId,
		apiKeyProfileId: options.apiKeyProfileId,
		profileId: context.profileId,
	},
	settings: context.settings,
	input: [
		{ role: "system", content: context.systemPrompt },
		...context.messages.map((m) => ({ role: m.role, content: m.content })),
		{ role: "user", content: query },
	],
	sources: context.sources,
	tools: context.tools,
	modelCalls: 0,
	pendingCallIds: [],
	conversation: options.conversation,
});

const addUsage = (a: AIUsage | undefined, b: AIUsage): AIUsage =>
	a
		? {
				inputTokens: a.inputTokens + b.inputTokens,
				outputTokens: a.outputTokens + b.outputTokens,
				totalTokens: a.totalTokens + b.totalTokens,
			}
		: b;

/**
 * Runs a tool loop to the end for the non-streaming routes (usage summed
 * over its calls). Sources are the loop's `sources` event, else `sources`.
 */
const collectToolTurn = async (
	sources: SearchResult[],
	loop: AsyncGenerator<ChatStreamEvent, TurnOutcome>,
): Promise<{ result: QueryResult; outcome: TurnOutcome }> => {
	let usage: AIUsage | undefined;
	let toolCalls: Extract<ToolLoopEvent, { type: "tool_calls" }>["data"] | undefined;
	let step = await loop.next();
	while (!step.done) {
		const event = step.value;
		if (event.type === "sources") sources = event.data;
		if (event.type === "usage") usage = addUsage(usage, event.data);
		if (event.type === "tool_calls") toolCalls = event.data;
		step = await loop.next();
	}
	const outcome = step.value;
	return {
		result: {
			answer: outcome.answer,
			sources,
			usage,
			finishReason: outcome.finishReason,
			...(toolCalls && {
				toolCalls: toolCalls.calls,
				continuationId: toolCalls.continuationId,
				expiresAt: toolCalls.expiresAt,
			}),
		},
		outcome,
	};
};

// ============================================================================
// Chat entry points
// ============================================================================

/**
 * Query the RAG system (non-streaming).
 * Reserves credits first and settles on actual usage afterwards. With
 * enabled profile tools the answer may be a tool call request instead.
 */
export const queryRAG = async (
	query: string,
	options: ChatOptions,
): Promise<QueryResult> => {
	const context = await prepareChat(query, options);

	if (context.tools.length > 0) {
		const state = startToolTurn(query, context, options);
		const { result } = await collectToolTurn(
			context.sources,
			runToolLoop(state, toolLoopDeps(options, "query_tools"), null),
		);
		return result;
	}

	const charge = await reserveChat(
		context.settings,
		plainPromptTokens(context, query),
		options,
	);

	// True once the provider accepted the request; a rejected call is refunded
	let providerCalled = false;
	let usage: AIUsage | null = null;
	try {
		let result: { text: string; usage: AIUsage; finishReason?: string };
		try {
			result = await OpenRouterQuery(
				{
					model: context.settings.modelId,
					temperature: context.settings.temperature,
					topP: context.settings.topP,
					maxTokens: context.settings.maxTokens,
					reasoning: context.settings.reasoning as ReasoningEffort,
					stream: false,
				},
				context.messages,
				context.systemPrompt,
				query,
			);
		} catch (err) {
			console.error("[RAG] Provider call failed:", describeError(err));
			throw toChatProviderError(err);
		}
		providerCalled = true;
		usage = result.usage;

		return {
			// An empty answer is billed (usage is set) and reported as a 502
			answer: requireAnswer(result.text, result.finishReason),
			sources: context.sources,
			usage: result.usage,
			finishReason: "stop",
		};
	} finally {
		await settleChat({
			charge,
			options,
			providerCalled,
			usage,
			context: "query",
		});
	}
};

/**
 * Query the RAG system with streaming.
 * Reserves credits first; settles in `finally`, so completed, failed and
 * abandoned (client disconnect) streams are all billed. The caller ends the
 * stream (`done`) once the outcome is stored.
 */
export async function* queryRAGStream(
	query: string,
	options: ChatOptions,
): AsyncGenerator<ChatStreamEvent, TurnOutcome, unknown> {
	const context = await prepareChat(query, options);

	if (context.tools.length > 0) {
		const state = startToolTurn(query, context, options);
		// Sources follow the first reservation, as on the plain path
		return yield* runToolLoop(
			state,
			toolLoopDeps(options, "query_stream_tools"),
			null,
			[{ type: "sources", data: context.sources }],
		);
	}

	const charge = await reserveChat(
		context.settings,
		plainPromptTokens(context, query),
		options,
	);

	let providerCalled = false;
	let getUsage: (() => Promise<AIUsage>) | null = null;
	let usage: AIUsage | null = null;
	let answer = "";

	try {
		yield { type: "sources", data: context.sources };

		try {
			const call = OpenRouterQuery(
				{
					model: context.settings.modelId,
					temperature: context.settings.temperature,
					topP: context.settings.topP,
					maxTokens: context.settings.maxTokens,
					reasoning: context.settings.reasoning as ReasoningEffort,
					stream: true,
				},
				context.messages,
				context.systemPrompt,
				query,
			);
			getUsage = call.getUsage;

			// Any chunk, or the end of the stream, means the provider accepted the
			// request. An answer without text ends in an error event, still billed.
			const accepted = () => {
				providerCalled = true;
			};
			for await (const delta of requireStreamedAnswer(call.stream, accepted)) {
				answer += delta;
				yield { type: "token", data: delta };
			}
		} catch (err) {
			// Consumer abort/close arrives as generator return, not a throw
			console.error("[RAG] Provider stream failed:", describeError(err));
			throw toChatProviderError(err);
		}
	} finally {
		if (providerCalled) usage = await fetchStreamUsage(getUsage);
		await settleChat({
			charge,
			options,
			providerCalled,
			usage,
			context: "query_stream",
		});
	}

	if (usage) yield { type: "usage", data: usage };
	return { finishReason: "stop", answer, conversation: options.conversation };
}

// Sources of the stored turn, re-emitted once the first call is reserved
const storedSources = (state: ToolTurnState) => [
	{ type: "sources" as const, data: state.sources as SearchResult[] },
];

/**
 * A turn whose profile was deleted meanwhile is gone (404). Otherwise the
 * turn keeps the tools and settings it started with, for its 15 minutes.
 */
const profileStillExists = async (state: ToolTurnState): Promise<void> => {
	const { profileId, userId } = state.binding;
	if (profileId && !(await getProfile(profileId, userId))) {
		throw new ORPCError("NOT_FOUND", { message: "Continuation not found" });
	}
};

/**
 * Continue a tool turn with the client's results (non-streaming). No
 * retrieval: the sources and prompt come from the stored turn.
 */
export const continueRAG = async (
	continuationId: string,
	toolResults: ToolResult[],
	caller: ContinuationCaller,
): Promise<{ result: QueryResult; outcome: TurnOutcome }> => {
	return collectToolTurn(
		[],
		continueToolTurn({
			redis,
			continuationId,
			toolResults,
			caller,
			deps: toolLoopDeps(caller, "continue"),
			leadEvents: storedSources,
			checkState: profileStillExists,
		}),
	);
};

/** Continue a tool turn with the client's results, streaming. */
export async function* continueRAGStream(
	continuationId: string,
	toolResults: ToolResult[],
	caller: ContinuationCaller,
): AsyncGenerator<ChatStreamEvent, TurnOutcome, unknown> {
	return yield* continueToolTurn({
		redis,
		continuationId,
		toolResults,
		caller,
		deps: toolLoopDeps(caller, "continue_stream"),
		leadEvents: storedSources,
		checkState: profileStillExists,
	});
}
