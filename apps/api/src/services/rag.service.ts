import { randomUUID } from "node:crypto";
import { db, document } from "@repo/db";
import { searchVectors } from "@repo/qdrant";
import {
	eq,
	and,
	or,
	isNull,
	inArray,
	desc,
	count,
} from "@repo/db/drizzle-orm";
import {
	OpenRouterQuery,
	DEFAULT_EMBEDDING_MODEL,
	OpenRouterEmbed,
	type AIUsage,
} from "@repo/llm/openrouter";
import { ORPCError } from "@orpc/server";
import { describeError } from "../config/redact";
import { toChatProviderError } from "../utils/provider-error";
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
import { estimateTokens } from "./chunking.service";

const DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_MAX_TOKENS = 2048;
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
	};
	// Organization billed for the call
	organizationId: string;
	// Owner of the documents to search (mandatory: retrieval is always scoped to it)
	userId: string;
	// Chat-only API key: only documents explicitly in the profile, never the
	// profile-less ones the default profile otherwise includes
	strictProfile?: boolean;
}

export interface QueryResult {
	answer: string;
	sources: Array<{
		documentId: string;
		chunkId: string;
		content: string;
		score: number;
	}>;
	usage?: AIUsage;
}

export interface SearchResult {
	documentId: string;
	chunkId: string;
	content: string;
	score: number;
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
const profileDocumentsFilter = (
	profile: { id: string; isDefault: boolean },
	userId: string,
	strict = false,
) =>
	and(
		eq(document.userId, userId),
		profile.isDefault && !strict
			? or(eq(document.profileId, profile.id), isNull(document.profileId))
			: eq(document.profileId, profile.id),
	);

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
	const searchable = await db
		.select({ id: document.id })
		.from(document)
		.where(
			and(
				scopeToProfile
					? profileDocumentsFilter(profile, userId, options.strictProfile)
					: eq(document.userId, userId),
				eq(document.embeddingModel, embeddingModelId),
				filter?.documentId
					? eq(document.id, filter.documentId)
					: eq(document.status, "indexed"),
			),
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
		documentIds: scopeToProfile ? searchable.map((d) => d.id) : undefined,
		source: filter?.source,
	});

	const results = await searchVectors(qdrant, collectionName, embeddings[0], {
		limit,
		scoreThreshold,
		filter: qdrantFilter,
	});

	return results.map((r) => {
		const payload = r.payload as unknown as VectorPayload;
		return {
			documentId: payload.documentId,
			chunkId: payload.chunkId,
			content: payload.content,
			score: r.score,
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

interface PreparedChat {
	modelId: string;
	maxTokens: number;
	temperature: number;
	topP: number | undefined;
	reasoning: ReasoningEffort;
	systemPrompt: string;
	messages: ChatMessage[];
	sources: SearchResult[];
	promptTokens: number;
	reservation: CreditReservation;
	usageId: string;
}

/**
 * Everything both chat paths share: load the profile, retrieve context, build
 * the one system prompt, and reserve the worst-case cost of the call.
 * Throws FORBIDDEN (before any LLM spend) when the balance cannot cover it.
 */
const prepareChat = async (
	query: string,
	options: QueryOptions,
): Promise<PreparedChat> => {
	const { organizationId, userId } = options;

	const profile = await loadProfile(options.profileId, userId);

	const modelId = profile?.model ?? DEFAULT_CHAT_MODEL;
	if (!isKnownChatModel(modelId))
		throw new ORPCError("BAD_REQUEST", {
			message: `Unsupported model: ${modelId}`,
		});

	const sources = await searchWithProfile(query, profile, options);

	const context = sources.map((r, i) => `[${i + 1}] ${r.content}`).join("\n\n");
	const systemPrompt = buildSystemPrompt(profile, context);
	const messages = options.messages ?? [];

	// Tokenize the full prompt that will be sent
	const promptTokens =
		estimateTokens(systemPrompt) +
		estimateTokens(query) +
		messages.reduce(
			(sum, m) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD_TOKENS,
			0,
		) +
		2 * MESSAGE_OVERHEAD_TOKENS;
	const maxTokens = profile?.maxTokens ?? DEFAULT_MAX_TOKENS;

	const estimatedCost = Math.max(
		estimateChatCost(modelId, promptTokens, maxTokens),
		CREDIT_EPSILON,
	);

	const usageId = randomUUID();
	const reservation = await reserveCredits({
		orgId: organizationId,
		userId,
		amount: estimatedCost,
		description: `chat reservation — ${modelId}`,
		referenceId: usageId,
	});

	return {
		modelId,
		maxTokens,
		temperature: profile?.temperature ?? 1.0,
		topP: profile?.topP,
		reasoning: (profile?.reasoningEffort as ReasoningEffort | undefined) ?? "none",
		systemPrompt,
		messages,
		sources,
		promptTokens,
		reservation,
		usageId,
	};
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
	prepared: PreparedChat;
	options: QueryOptions;
	providerCalled: boolean;
	usage: AIUsage | null;
	context: string;
}): Promise<void> => {
	const { prepared, options, providerCalled, usage, context } = input;
	const { modelId, reservation, usageId } = prepared;

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
		inputTokens: usageKnown && usage ? usage.inputTokens : prepared.promptTokens,
		outputTokens: usageKnown && usage ? usage.outputTokens : 0,
		costCredits: cost,
		metadata: { context, usageEstimated: !usageKnown },
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

/**
 * Query the RAG system (non-streaming).
 * Reserves credits first and settles on actual usage afterwards.
 */
export const queryRAG = async (
	query: string,
	options: QueryOptions,
): Promise<QueryResult> => {
	const prepared = await prepareChat(query, options);

	// True once the provider accepted the request; a rejected call is refunded
	let providerCalled = false;
	let usage: AIUsage | null = null;
	try {
		let result: { text: string; usage: AIUsage };
		try {
			result = await OpenRouterQuery(
				{
					model: prepared.modelId,
					temperature: prepared.temperature,
					topP: prepared.topP,
					maxTokens: prepared.maxTokens,
					reasoning: prepared.reasoning,
					stream: false,
				},
				prepared.messages,
				prepared.systemPrompt,
				query,
			);
		} catch (err) {
			console.error("[RAG] Provider call failed:", describeError(err));
			throw toChatProviderError(err);
		}
		providerCalled = true;
		usage = result.usage;

		return {
			answer: result.text,
			sources: prepared.sources,
			usage: result.usage,
		};
	} finally {
		await settleChat({
			prepared,
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
 * abandoned (client disconnect) streams are all billed.
 */
export async function* queryRAGStream(
	query: string,
	options: QueryOptions,
): AsyncGenerator<
	| { type: "sources"; data: SearchResult[] }
	| { type: "token"; data: string }
	| { type: "usage"; data: AIUsage }
	| { type: "done" },
	void,
	unknown
> {
	const prepared = await prepareChat(query, options);

	let providerCalled = false;
	let getUsage: (() => Promise<AIUsage>) | null = null;
	let usage: AIUsage | null = null;

	try {
		yield { type: "sources", data: prepared.sources };

		try {
			const call = OpenRouterQuery(
				{
					model: prepared.modelId,
					temperature: prepared.temperature,
					topP: prepared.topP,
					maxTokens: prepared.maxTokens,
					reasoning: prepared.reasoning,
					stream: true,
				},
				prepared.messages,
				prepared.systemPrompt,
				query,
			);
			getUsage = call.getUsage;

			for await (const delta of call.stream) {
				// First chunk: the provider accepted the request
				providerCalled = true;
				if (delta) {
					yield { type: "token", data: delta };
				}
			}
			// Finished without any chunk (empty answer): still accepted
			providerCalled = true;
		} catch (err) {
			// Consumer abort/close arrives as generator return, not a throw
			console.error("[RAG] Provider stream failed:", describeError(err));
			throw toChatProviderError(err);
		}
	} finally {
		if (providerCalled) usage = await fetchStreamUsage(getUsage);
		await settleChat({
			prepared,
			options,
			providerCalled,
			usage,
			context: "query_stream",
		});
	}

	if (usage) yield { type: "usage", data: usage };
	yield { type: "done" };
}
