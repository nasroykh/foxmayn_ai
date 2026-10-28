import { createHash, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type {
	AIUsage,
	ToolTurnEvent,
	ToolTurnItem,
	ToolDefinition,
} from "@repo/llm/openrouter";
import { describeErrorBrief } from "../config/redact";
import { checkToolCall, type ToolSpec } from "../utils/profile_tools";
import { noAnswerError, toChatProviderError } from "../utils/provider-error";

/**
 * Client-executed tools: the model asks for a call, the stream ends with a
 * `tool_calls` event, the client runs the tool and posts the result to
 * /chat/continue. The state between the two requests lives in Redis.
 *
 * Retrieval runs once per user turn; every model call reserves and settles
 * its own credits. Nothing here may log arguments or results (PII).
 */

// Model calls per user turn, across the request and its continues. The last
// one runs with tools off, so it has to answer in text.
export const MAX_MODEL_CALLS_PER_TURN = 3;
export const CONTINUATION_TTL_SECONDS = 15 * 60;
export const TOOL_RESULT_MAX_CHARS = 8000;

// Per-message framing overhead of chat formats, in tokens
const MESSAGE_OVERHEAD_TOKENS = 4;

export interface ModelSettings {
	modelId: string;
	maxTokens: number;
	temperature: number;
	topP: number | undefined;
	reasoning: string;
}

/** Who may continue a turn: the same organization, user and API key (or session user). */
export interface ContinuationBinding {
	organizationId: string;
	userId: string;
	apiKeyId: string | null;
	profileId: string | null;
}

/** A server-managed conversation stores the exchange once the turn ends in text. */
export interface TurnConversation {
	serverManaged: boolean;
	conversationId: string | null;
	// Profile the request named (or the conversation's), stored on a new conversation
	profileId: string | null;
	userQuery: string;
}

export interface ToolTurnState<TSource = unknown> {
	binding: ContinuationBinding;
	settings: ModelSettings;
	// System prompt (with the retrieved context), history, query, then each round
	input: ToolTurnItem[];
	sources: TSource[];
	// Enabled tools when the turn started
	tools: ToolSpec[];
	modelCalls: number;
	pendingCallIds: string[];
	conversation: TurnConversation;
	// Set when stored, so a continuation put back after a failure keeps its expiry
	expiresAt?: string;
}

export interface ToolCallEvent {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export type ToolLoopEvent =
	| { type: "token"; data: string }
	| {
			type: "tool_calls";
			data: { continuationId: string; expiresAt: string; calls: ToolCallEvent[] };
	  }
	| { type: "usage"; data: AIUsage };

export interface TurnOutcome {
	finishReason: "stop" | "tool_calls";
	// Text of the last model call (the answer, or the preamble of a tool turn)
	answer: string;
	conversation: TurnConversation;
}

export interface CallOutcome {
	providerCalled: boolean;
	usage: AIUsage | null;
	promptTokens: number;
	round: number;
	// The continuation this call continued, null for the user's own request
	continuationId: string | null;
}

export interface ToolLoopDeps<TCharge> {
	callModel: (
		settings: ModelSettings,
		input: ToolTurnItem[],
		tools: ToolDefinition[],
		toolChoice: "auto" | "none",
	) => AsyncIterable<ToolTurnEvent>;
	// Throws FORBIDDEN (before the call) when credits cannot cover it
	reserve: (settings: ModelSettings, promptTokens: number) => Promise<TCharge>;
	// Never throws
	settle: (charge: TCharge, outcome: CallOutcome) => Promise<void>;
	saveContinuation: (
		state: ToolTurnState,
	) => Promise<{ continuationId: string; expiresAt: string }>;
	countTokens: (text: string) => number;
}

/** Worst-case input size of a call: every item plus the tool definitions. */
export const estimatePromptTokens = (
	input: ToolTurnItem[],
	tools: ToolSpec[],
	countTokens: (text: string) => number,
): number =>
	input.reduce(
		(sum, item) =>
			sum +
			countTokens(
				typeof item.content === "string" ? item.content : JSON.stringify(item),
			) +
			MESSAGE_OVERHEAD_TOKENS,
		0,
	) + (tools.length > 0 ? countTokens(JSON.stringify(tools)) : 0);

// Result for a valid call the model made next to an invalid one: never run
const NOT_RUN_RESULT = {
	error: "not_run",
	details: "Another call in the same turn was invalid; call the tools again",
};

/**
 * Runs model calls until the turn ends in text or valid tool calls.
 * Invalid calls (unknown tool, bad JSON, schema failure) are never sent to
 * the client: the model gets an error result and is called again, which
 * counts as a round. Mutates `state`.
 *
 * `leadEvents` are yielded once the first call is reserved, so a request the
 * organization cannot pay for fails before anything is streamed.
 */
export async function* runToolLoop<TCharge, TLead = never>(
	state: ToolTurnState,
	deps: ToolLoopDeps<TCharge>,
	continuedFrom: string | null,
	leadEvents: readonly TLead[] = [],
): AsyncGenerator<ToolLoopEvent | TLead, TurnOutcome> {
	let led = false;
	while (true) {
		state.modelCalls += 1;
		const round = state.modelCalls;
		const toolsOn =
			state.tools.length > 0 && round < MAX_MODEL_CALLS_PER_TURN;

		const promptTokens = estimatePromptTokens(
			state.input,
			state.tools,
			deps.countTokens,
		);
		const charge = await deps.reserve(state.settings, promptTokens);

		let providerCalled = false;
		let completed: Extract<ToolTurnEvent, { type: "completed" }> | null = null;
		let text = "";
		try {
			if (!led) {
				led = true;
				yield* leadEvents;
			}
			try {
				const events = deps.callModel(
					state.settings,
					state.input,
					state.tools,
					toolsOn ? "auto" : "none",
				);
				for await (const event of events) {
					// Any event means the provider accepted the request
					providerCalled = true;
					if (event.type === "text") {
						text += event.delta;
						yield { type: "token", data: event.delta };
					} else if (event.type === "completed") {
						completed = event;
					}
				}
				if (!completed) throw new Error("Model call ended without a response");
			} catch (err) {
				// Consumer abort/close arrives as generator return, not a throw
				// Name and status only: the request carries tool arguments and results
				console.error("[RAG] Provider tool stream failed:", describeErrorBrief(err));
				throw toChatProviderError(err);
			}
		} finally {
			await deps.settle(charge, {
				providerCalled,
				usage: completed?.usage ?? null,
				promptTokens,
				round,
				continuationId: continuedFrom,
			});
		}

		const usage = completed.usage;
		// A call the model makes with tools off is dropped: it must answer
		const calls = toolsOn ? completed.toolCalls : [];

		if (calls.length === 0) {
			// An empty answer is billed (settled above) and reported as a 502
			if (!text.trim()) throw noAnswerError(completed.finishReason);
			if (usage) yield { type: "usage", data: usage };
			return { finishReason: "stop", answer: text, conversation: state.conversation };
		}

		state.input.push(...completed.output);
		const checks = calls.map((call) => ({
			call,
			check: checkToolCall(state.tools, call.name, call.arguments),
		}));

		if (checks.every(({ check }) => check.ok)) {
			state.pendingCallIds = calls.map((c) => c.id);
			let saved: { continuationId: string; expiresAt: string };
			try {
				saved = await deps.saveContinuation(state);
			} catch (err) {
				// The call is billed; without a continuation the turn cannot go on
				console.error("[RAG] Could not store a tool continuation:", describeErrorBrief(err));
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: "Could not store the tool calls. Try again shortly.",
				});
			}
			const { continuationId, expiresAt } = saved;
			yield {
				type: "tool_calls",
				data: {
					continuationId,
					expiresAt,
					calls: checks.map(({ call, check }) => ({
						id: call.id,
						name: call.name,
						arguments: check.ok ? check.arguments : {},
					})),
				},
			};
			if (usage) yield { type: "usage", data: usage };
			return {
				finishReason: "tool_calls",
				answer: text,
				conversation: state.conversation,
			};
		}

		for (const { call, check } of checks) {
			state.input.push({
				type: "function_call_output",
				callId: call.id,
				output: JSON.stringify(check.ok ? NOT_RUN_RESULT : check.error),
			});
		}
		if (usage) yield { type: "usage", data: usage };
	}
}

export interface ToolResult {
	toolCallId: string;
	content: string;
}

/** Exactly one result per pending call: no missing, extra or repeated ids. */
export const toolResultsMatch = (
	pendingCallIds: string[],
	results: ToolResult[],
): boolean => {
	const ids = new Set(results.map((r) => r.toolCallId));
	return (
		ids.size === results.length &&
		results.length === pendingCallIds.length &&
		pendingCallIds.every((id) => ids.has(id))
	);
};

/** Tool results go to the model as call outputs (untrusted data, never in the system prompt). */
export const appendToolResults = (state: ToolTurnState, results: ToolResult[]) => {
	for (const result of results) {
		state.input.push({
			type: "function_call_output",
			callId: result.toolCallId,
			output: result.content,
		});
	}
	state.pendingCallIds = [];
};

// ============================================================================
// Continuation store
// ============================================================================

/** Minimal Redis surface the store needs (lets tests use an in-memory fake). */
export interface ContinuationRedis {
	set(key: string, value: string, ex: "EX", seconds: number): Promise<unknown>;
	getdel(key: string): Promise<string | null>;
}

/** The caller of a continue request, as resolved by the auth middleware. */
export interface ContinuationCaller {
	organizationId: string;
	userId: string;
	apiKeyId: string | null;
	// Set for chat-only keys: the knowledge base the key is bound to
	apiKeyProfileId: string | null;
}

// The key includes the binding, so a caller with another identity finds
// nothing and cannot use up (claim) someone else's continuation
const continuationKey = (
	id: string,
	binding: { organizationId: string; userId: string; apiKeyId: string | null },
): string =>
	`chat:continuation:${createHash("sha256")
		.update(
			[id, binding.organizationId, binding.userId, binding.apiKeyId ?? "session"].join(
				"\n",
			),
		)
		.digest("hex")}`;

/** Stores the state under a new random id (256 bits) for CONTINUATION_TTL_SECONDS. */
export const saveContinuation = async (
	redis: ContinuationRedis,
	state: ToolTurnState,
	now: Date = new Date(),
): Promise<{ continuationId: string; expiresAt: string }> => {
	const continuationId = randomBytes(32).toString("base64url");
	const expiresAt = new Date(
		now.getTime() + CONTINUATION_TTL_SECONDS * 1000,
	).toISOString();
	await redis.set(
		continuationKey(continuationId, state.binding),
		JSON.stringify({ ...state, expiresAt }),
		"EX",
		CONTINUATION_TTL_SECONDS,
	);
	return { continuationId, expiresAt };
};

/**
 * Puts a claimed continuation back until its original expiry, for a continue
 * that failed before the provider accepted a call (bad results, no credits,
 * provider rejected it). Never throws.
 */
const restoreContinuation = async (
	redis: ContinuationRedis,
	continuationId: string,
	state: ToolTurnState,
	now: Date = new Date(),
): Promise<void> => {
	const seconds = Math.floor(
		(Date.parse(state.expiresAt ?? "") - now.getTime()) / 1000,
	);
	if (!(seconds > 0)) return;
	try {
		await redis.set(
			continuationKey(continuationId, state.binding),
			JSON.stringify(state),
			"EX",
			seconds,
		);
	} catch (err) {
		console.error("[RAG] Could not restore a tool continuation:", describeErrorBrief(err));
	}
};

/**
 * Takes the state out of Redis (single use, atomic GETDEL). Returns null when
 * it is unknown, expired, already used or bound to someone else: the caller
 * answers all of these with the same 404.
 */
export const claimContinuation = async <TSource>(
	redis: ContinuationRedis,
	continuationId: string,
	caller: ContinuationCaller,
): Promise<ToolTurnState<TSource> | null> => {
	const raw = await redis.getdel(continuationKey(continuationId, caller));
	if (!raw) return null;
	let state: ToolTurnState<TSource>;
	try {
		state = JSON.parse(raw) as ToolTurnState<TSource>;
	} catch {
		return null;
	}
	const { binding } = state;
	const bound =
		binding.organizationId === caller.organizationId &&
		binding.userId === caller.userId &&
		binding.apiKeyId === caller.apiKeyId &&
		(!caller.apiKeyProfileId || binding.profileId === caller.apiKeyProfileId);
	return bound ? state : null;
};

/**
 * Continues a tool turn with the client's results: claims the continuation,
 * checks one result per pending call, then runs the loop. Unknown, expired,
 * used and foreign continuations are the same 404. When the continue fails
 * before the provider accepted a call, the continuation is put back, so the
 * client can retry (e.g. after a top-up) without losing the turn.
 */
export async function* continueToolTurn<TCharge, TLead = never>(input: {
	redis: ContinuationRedis;
	continuationId: string;
	toolResults: ToolResult[];
	caller: ContinuationCaller;
	deps: ToolLoopDeps<TCharge>;
	leadEvents?: (state: ToolTurnState) => readonly TLead[];
	now?: () => Date;
}): AsyncGenerator<ToolLoopEvent | TLead, TurnOutcome> {
	const { redis, continuationId, toolResults, caller } = input;
	const now = input.now ?? (() => new Date());
	const state = await claimContinuation(redis, continuationId, caller);
	if (!state) {
		throw new ORPCError("NOT_FOUND", { message: "Continuation not found" });
	}
	const claimed = structuredClone(state);
	if (!toolResultsMatch(state.pendingCallIds, toolResults)) {
		await restoreContinuation(redis, continuationId, claimed, now());
		throw new ORPCError("BAD_REQUEST", {
			message: "Send exactly one result for each pending tool call",
		});
	}
	appendToolResults(state, toolResults);

	let accepted = false;
	const deps: ToolLoopDeps<TCharge> = {
		...input.deps,
		settle: (charge, outcome) => {
			if (outcome.providerCalled) accepted = true;
			return input.deps.settle(charge, outcome);
		},
	};
	let finished = false;
	try {
		const outcome = yield* runToolLoop(
			state,
			deps,
			continuationId,
			input.leadEvents?.(state) ?? [],
		);
		finished = true;
		return outcome;
	} finally {
		if (!finished && !accepted) {
			await restoreContinuation(redis, continuationId, claimed, now());
		}
	}
}
