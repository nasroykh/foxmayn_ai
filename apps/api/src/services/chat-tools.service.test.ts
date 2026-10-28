import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import {
	readToolTurnStream,
	type ToolTurnEvent,
	type ToolTurnItem,
} from "@repo/llm/openrouter";
import {
	appendToolResults,
	claimContinuation,
	continueToolTurn,
	CONTINUATION_TTL_SECONDS,
	MAX_MODEL_CALLS_PER_TURN,
	runToolLoop,
	saveContinuation,
	toolResultsMatch,
	type CallOutcome,
	type ContinuationCaller,
	type ContinuationRedis,
	type ToolLoopDeps,
	type ToolTurnState,
} from "./chat-tools.service";
import { enabledTools } from "../utils/profile_tools";
import { resolveKnowledgeBase } from "../router/access";

// ============================================================================
// Fakes
// ============================================================================

/** In-memory Redis with SET EX and GETDEL, on a clock the test moves. */
class FakeRedis implements ContinuationRedis {
	now = 0;
	entries = new Map<string, { value: string; expiresAt: number }>();
	ttls: number[] = [];
	async set(key: string, value: string, _ex: "EX", seconds: number) {
		this.ttls.push(seconds);
		this.entries.set(key, { value, expiresAt: this.now + seconds * 1000 });
		return "OK";
	}
	async getdel(key: string) {
		const entry = this.entries.get(key);
		this.entries.delete(key);
		return entry && entry.expiresAt > this.now ? entry.value : null;
	}
}

const TOOLS = enabledTools([
	{
		name: "lookup_order",
		description: "Find an order",
		parameters: {
			type: "object",
			properties: { orderId: { type: "string" } },
			required: ["orderId"],
			additionalProperties: false,
		},
		enabled: true,
	},
]);

const OWNER: ContinuationCaller = {
	organizationId: "org-1",
	userId: "user-1",
	apiKeyId: "key-1",
	apiKeyProfileId: "kb-1",
};

const newState = (): ToolTurnState => ({
	binding: {
		organizationId: OWNER.organizationId,
		userId: OWNER.userId,
		apiKeyId: OWNER.apiKeyId,
		profileId: "kb-1",
	},
	settings: {
		modelId: "test/model",
		maxTokens: 500,
		temperature: 1,
		topP: 1,
		reasoning: "none",
	},
	input: [
		{ role: "system", content: "You answer from the context." },
		{ role: "user", content: "Where is order A-1?" },
	],
	sources: [{ documentId: "d1" }],
	tools: TOOLS,
	modelCalls: 0,
	pendingCallIds: [],
	conversation: {
		serverManaged: true,
		conversationId: null,
		profileId: "kb-1",
		userQuery: "Where is order A-1?",
	},
});

const USAGE = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };

type Reply =
	| { text?: string; call?: { id: string; name: string; arguments: string }; usage?: typeof USAGE | null }
	| { reject: true }
	| { failAfterText: string }
	// Accepted (HTTP 200), then the stream breaks before any text
	| { failAfterAccept: true };

const callItem = (call: { id: string; name: string; arguments: string }): ToolTurnItem => ({
	type: "function_call",
	callId: call.id,
	name: call.name,
	arguments: call.arguments,
});

/** Provider that plays scripted replies and records every request. */
const fakeDeps = (replies: Reply[], redis = new FakeRedis()) => {
	const requests: { toolChoice: string; input: ToolTurnItem[]; toolCount: number }[] = [];
	const reserves: number[] = [];
	const settles: CallOutcome[] = [];
	let charges = 0;
	const deps: ToolLoopDeps<number> & { reserveError?: Error } = {
		async *callModel(_settings, input, tools, toolChoice) {
			requests.push({ toolChoice, input: structuredClone(input), toolCount: tools.length });
			const reply = replies.shift();
			assert.ok(reply, "unexpected model call");
			if ("reject" in reply) {
				throw Object.assign(new Error("Bad request"), { statusCode: 400 });
			}
			yield { type: "accepted" } satisfies ToolTurnEvent;
			if ("failAfterAccept" in reply) throw new Error("socket hang up");
			if ("failAfterText" in reply) {
				yield { type: "text", delta: reply.failAfterText } satisfies ToolTurnEvent;
				throw new Error("connection reset");
			}
			if (reply.text) {
				for (const part of reply.text.split(/(?<= )/)) {
					yield { type: "text", delta: part } satisfies ToolTurnEvent;
				}
			}
			const output: ToolTurnItem[] = [];
			if (reply.text) output.push({ type: "message", role: "assistant", content: reply.text });
			if (reply.call) output.push(callItem(reply.call));
			yield {
				type: "completed",
				output,
				toolCalls: reply.call ? [reply.call] : [],
				usage: reply.usage === undefined ? USAGE : reply.usage,
			} satisfies ToolTurnEvent;
		},
		async reserve(_settings, promptTokens) {
			if (deps.reserveError) throw deps.reserveError;
			reserves.push(promptTokens);
			return ++charges;
		},
		async settle(_charge, outcome) {
			settles.push(outcome);
		},
		saveContinuation: (state) => saveContinuation(redis, state, new Date(redis.now)),
		countTokens: (text) => Math.ceil(text.length / 4),
	};
	return { deps, requests, reserves, settles, redis };
};

/** Runs a loop to the end; returns its events and outcome. */
const drain = async <T, R>(loop: AsyncGenerator<T, R>) => {
	const events: T[] = [];
	let step = await loop.next();
	while (!step.done) {
		events.push(step.value);
		step = await loop.next();
	}
	return { events, outcome: step.value };
};

const SOURCES = { type: "sources" as const, data: [{ documentId: "d1" }] };

/** Event types in order, with a run of tokens shown once. */
const sequence = (events: { type: string }[]) =>
	events
		.map((e) => e.type)
		.filter((type, i, all) => type !== "token" || all[i - 1] !== "token");

// ============================================================================
// Loop
// ============================================================================

test("a tool turn streams sources, preamble, tool_calls, usage in that order", async () => {
	const { deps, requests, settles, redis } = fakeDeps([
		{
			text: "Let me check. ",
			call: { id: "call_1", name: "lookup_order", arguments: '{"orderId":"A-1"}' },
		},
	]);
	const state = newState();
	const { events, outcome } = await drain(runToolLoop(state, deps, null, [SOURCES]));

	assert.deepEqual(sequence(events), ["sources", "token", "tool_calls", "usage"]);
	const toolCalls = events.find((e) => e.type === "tool_calls");
	assert.ok(toolCalls?.type === "tool_calls");
	assert.deepEqual(toolCalls.data.calls, [
		{ id: "call_1", name: "lookup_order", arguments: { orderId: "A-1" } },
	]);
	// At least 128 random bits, expiry 15 minutes ahead
	assert.ok(Buffer.from(toolCalls.data.continuationId, "base64url").length >= 16);
	assert.equal(
		toolCalls.data.expiresAt,
		new Date(CONTINUATION_TTL_SECONDS * 1000).toISOString(),
	);
	assert.deepEqual(redis.ttls, [CONTINUATION_TTL_SECONDS]);

	assert.equal(outcome.finishReason, "tool_calls");
	assert.equal(outcome.answer, "Let me check. ");
	assert.equal(requests[0].toolChoice, "auto");
	assert.equal(requests[0].toolCount, 1);
	assert.deepEqual(
		settles.map((s) => [s.round, s.providerCalled, s.continuationId]),
		[[1, true, null]],
	);
	assert.deepEqual(state.pendingCallIds, ["call_1"]);
});

test("a text answer ends with stop and is billed once", async () => {
	const { deps, settles } = fakeDeps([{ text: "Order A-1 shipped." }]);
	const { events, outcome } = await drain(runToolLoop(newState(), deps, null, [SOURCES]));
	assert.deepEqual(sequence(events), ["sources", "token", "usage"]);
	assert.deepEqual(outcome, {
		finishReason: "stop",
		answer: "Order A-1 shipped.",
		conversation: newState().conversation,
	});
	assert.equal(settles.length, 1);
	assert.deepEqual(settles[0].usage, USAGE);
});

for (const [label, call] of [
	["invalid JSON", { id: "c1", name: "lookup_order", arguments: '{"orderId":' }],
	["schema failure", { id: "c1", name: "lookup_order", arguments: '{"orderId":7}' }],
	["unknown tool", { id: "c1", name: "drop_tables", arguments: "{}" }],
] as const) {
	test(`${label}: never streamed, the model gets an error result and is called again`, async () => {
		const { deps, requests, settles } = fakeDeps([
			{ call },
			{ call: { id: "c2", name: "lookup_order", arguments: '{"orderId":"A-1"}' } },
		]);
		const { events } = await drain(runToolLoop(newState(), deps, null));

		const streamed = events.filter((e) => e.type === "tool_calls");
		assert.equal(streamed.length, 1);
		assert.ok(streamed[0].type === "tool_calls");
		assert.deepEqual(
			streamed[0].data.calls.map((c) => c.id),
			["c2"],
		);

		// The retry carries the bad call and an error result, never the arguments
		const retryInput = requests[1].input;
		const result = retryInput.at(-1)!;
		assert.equal(result.type, "function_call_output");
		assert.equal(result.callId, "c1");
		const error = JSON.parse(String(result.output)) as { error: string };
		assert.ok(["invalid_arguments", "unknown_tool"].includes(error.error));
		assert.equal(retryInput.at(-2)!.type, "function_call");

		// The retry is a round: reserved and settled on its own
		assert.deepEqual(
			settles.map((s) => s.round),
			[1, 2],
		);
		assert.equal(events.filter((e) => e.type === "usage").length, 2);
	});
}

test(`call ${MAX_MODEL_CALLS_PER_TURN} of a turn runs with tools off, across continues`, async () => {
	const redis = new FakeRedis();
	const valid = (id: string) => ({
		call: { id, name: "lookup_order", arguments: '{"orderId":"A-1"}' },
	});
	const { deps, requests, settles } = fakeDeps(
		[
			valid("c1"),
			valid("c2"),
			// Ignored: tools are off, so only the text counts
			{ text: "It shipped.", ...valid("c3") },
		],
		redis,
	);

	let state: ToolTurnState = newState();
	let continuedFrom: string | null = null;
	for (const id of ["c1", "c2"]) {
		const turn = await drain(runToolLoop(state, deps, continuedFrom));
		const toolCalls = turn.events.find((e) => e.type === "tool_calls");
		assert.ok(toolCalls?.type === "tool_calls");
		const continuationId: string = toolCalls.data.continuationId;
		continuedFrom = continuationId;
		const claimed: ToolTurnState | null = await claimContinuation(
			redis,
			continuationId,
			OWNER,
		);
		assert.ok(claimed);
		assert.deepEqual(claimed.pendingCallIds, [id]);
		appendToolResults(claimed, [{ toolCallId: id, content: '{"status":"shipped"}' }]);
		state = claimed;
	}
	const { events, outcome } = await drain(runToolLoop(state, deps, continuedFrom));

	assert.deepEqual(
		requests.map((r) => r.toolChoice),
		["auto", "auto", "none"],
	);
	assert.equal(outcome.finishReason, "stop");
	assert.equal(outcome.answer, "It shipped.");
	assert.equal(events.some((e) => e.type === "tool_calls"), false);
	// Tool results reach the model as call outputs, after the model's own call
	const lastInput = requests[2].input;
	assert.deepEqual(lastInput.at(-1), {
		type: "function_call_output",
		callId: "c2",
		output: '{"status":"shipped"}',
	});
	assert.equal(lastInput[0].content, "You answer from the context.");
	// One settlement per call, labelled with its round and the continuation it continued
	assert.deepEqual(
		settles.map((s) => [s.round, s.continuationId === null]),
		[
			[1, true],
			[2, false],
			[3, false],
		],
	);
});

test("invalid calls count as rounds: the third call answers in text", async () => {
	const bad = { call: { id: "c", name: "lookup_order", arguments: "{}" } };
	const { deps, requests } = fakeDeps([bad, bad, { text: "Sorry, I could not look it up." }]);
	const { outcome } = await drain(runToolLoop(newState(), deps, null));
	assert.equal(outcome.finishReason, "stop");
	assert.deepEqual(
		requests.map((r) => r.toolChoice),
		["auto", "auto", "none"],
	);
});

test("an empty final answer is a 502, still billed", async () => {
	const { deps, settles } = fakeDeps([{ text: "" }]);
	await assert.rejects(drain(runToolLoop(newState(), deps, null)), (err: unknown) => {
		assert.ok(err instanceof ORPCError);
		assert.equal(err.code, "BAD_GATEWAY");
		return true;
	});
	assert.equal(settles[0].providerCalled, true);
});

// ============================================================================
// Billing
// ============================================================================

test("provider rejects the request: refunded (not called), mapped to 502", async () => {
	const { deps, settles, reserves } = fakeDeps([{ reject: true }]);
	await assert.rejects(drain(runToolLoop(newState(), deps, null)), (err: unknown) => {
		assert.ok(err instanceof ORPCError);
		assert.equal(err.code, "BAD_GATEWAY");
		return true;
	});
	assert.equal(reserves.length, 1);
	assert.deepEqual(
		settles.map((s) => [s.providerCalled, s.usage]),
		[[false, null]],
	);
});

test("stream fails mid-answer: settled as called, without usage (reservation charged)", async () => {
	const { deps, settles } = fakeDeps([{ failAfterText: "Partial " }]);
	await assert.rejects(drain(runToolLoop(newState(), deps, null)));
	assert.deepEqual(
		settles.map((s) => [s.providerCalled, s.usage]),
		[[true, null]],
	);
});

test("stream fails after the provider accepted, before any text: billed, not refunded", async () => {
	const { deps, settles } = fakeDeps([{ failAfterAccept: true }]);
	await assert.rejects(drain(runToolLoop(newState(), deps, null)));
	assert.deepEqual(
		settles.map((s) => [s.providerCalled, s.usage]),
		[[true, null]],
	);
});

test("continuation store fails after a billed call: 503, not a bare 500", async () => {
	const { deps, settles } = fakeDeps([
		{ call: { id: "c1", name: "lookup_order", arguments: '{"orderId":"A-1"}' } },
	]);
	deps.saveContinuation = async () => {
		throw new Error("Connection is closed.");
	};
	await assert.rejects(drain(runToolLoop(newState(), deps, null)), {
		code: "SERVICE_UNAVAILABLE",
	});
	assert.equal(settles[0].providerCalled, true);
});

test("usage missing from the response: settled without usage", async () => {
	const { deps, settles } = fakeDeps([{ text: "Done.", usage: null }]);
	const { events } = await drain(runToolLoop(newState(), deps, null));
	assert.equal(events.some((e) => e.type === "usage"), false);
	assert.deepEqual(
		settles.map((s) => [s.providerCalled, s.usage]),
		[[true, null]],
	);
});

test("each call reserves the prompt, tool definitions and earlier rounds", async () => {
	const { deps, reserves } = fakeDeps([
		{ call: { id: "c1", name: "lookup_order", arguments: "{}" } },
		{ text: "Answer." },
	]);
	const state = newState();
	await drain(runToolLoop(state, deps, null));
	assert.equal(reserves.length, 2);
	assert.ok(reserves[1] > reserves[0], "the second call carries the first round");

	const noTools = { ...newState(), tools: [] };
	const plain = fakeDeps([{ text: "Answer." }]);
	await drain(runToolLoop(noTools, plain.deps, null));
	assert.ok(reserves[0] > plain.reserves[0], "tool definitions are reserved");
});

test("no credits: 403 before the provider call and before anything is streamed", async () => {
	const { deps, requests, settles } = fakeDeps([{ text: "never" }]);
	deps.reserveError = new ORPCError("FORBIDDEN", { message: "Insufficient credits" });
	const loop = runToolLoop(newState(), deps, null, [SOURCES]);
	await assert.rejects(loop.next(), { code: "FORBIDDEN" });
	assert.equal(requests.length, 0);
	assert.equal(settles.length, 0);
});

test("client disconnect mid-stream still settles the call", async () => {
	const { deps, settles } = fakeDeps([{ text: "A long answer here." }]);
	const loop = runToolLoop(newState(), deps, null, [SOURCES]);
	await loop.next(); // sources
	await loop.next(); // first token
	await loop.return(undefined as never);
	assert.deepEqual(
		settles.map((s) => s.providerCalled),
		[true],
	);
});

test("an abandoned continuation costs nothing: no call, no reservation", async () => {
	const { deps, reserves, settles, redis } = fakeDeps([
		{ call: { id: "c1", name: "lookup_order", arguments: '{"orderId":"A-1"}' } },
	]);
	await drain(runToolLoop(newState(), deps, null));
	// The client never continues; the state expires
	redis.now += CONTINUATION_TTL_SECONDS * 1000;
	assert.equal(redis.entries.size, 1);
	assert.equal(reserves.length, 1);
	assert.equal(settles.length, 1);
});

// ============================================================================
// Continuation store
// ============================================================================

const saved = async () => {
	const redis = new FakeRedis();
	const state = newState();
	state.pendingCallIds = ["c1"];
	const { continuationId } = await saveContinuation(redis, state, new Date(redis.now));
	return { redis, continuationId, state };
};

test("the owner claims a continuation exactly once", async () => {
	const { redis, continuationId, state } = await saved();
	assert.deepEqual(await claimContinuation(redis, continuationId, OWNER), {
		...state,
		expiresAt: new Date(CONTINUATION_TTL_SECONDS * 1000).toISOString(),
	});
	assert.equal(await claimContinuation(redis, continuationId, OWNER), null);
});

test("an expired continuation is not found", async () => {
	const { redis, continuationId } = await saved();
	redis.now += CONTINUATION_TTL_SECONDS * 1000;
	assert.equal(await claimContinuation(redis, continuationId, OWNER), null);
});

test("an unknown id is not found", async () => {
	const { redis } = await saved();
	assert.equal(await claimContinuation(redis, "not-an-id", OWNER), null);
});

for (const [label, caller] of [
	["another API key", { ...OWNER, apiKeyId: "key-2" }],
	["the same user's browser session", { ...OWNER, apiKeyId: null, apiKeyProfileId: null }],
	["another user", { ...OWNER, userId: "user-2" }],
	["another organization", { ...OWNER, organizationId: "org-2" }],
] as const) {
	test(`${label} cannot claim (and does not use up) the continuation`, async () => {
		const { redis, continuationId } = await saved();
		assert.equal(await claimContinuation(redis, continuationId, caller), null);
		assert.ok(await claimContinuation(redis, continuationId, OWNER));
	});
}

test("a chat-only key cannot continue a turn of another knowledge base", async () => {
	const { redis, continuationId } = await saved();
	const otherKb = { ...OWNER, apiKeyProfileId: "kb-2" };
	assert.equal(await claimContinuation(redis, continuationId, otherKb), null);
});

test("a chat-only key never reaches another profile (and so its tools)", () => {
	assert.throws(() => resolveKnowledgeBase("kb-2", "kb-1"), { code: "FORBIDDEN" });
	assert.equal(resolveKnowledgeBase(undefined, "kb-1"), "kb-1");
	assert.equal(resolveKnowledgeBase("kb-1", "kb-1"), "kb-1");
	assert.equal(resolveKnowledgeBase("kb-2", null), "kb-2");
});

test("tool results must match the pending calls exactly", () => {
	const r = (id: string) => ({ toolCallId: id, content: "ok" });
	assert.equal(toolResultsMatch(["a"], [r("a")]), true);
	assert.equal(toolResultsMatch(["a", "b"], [r("b"), r("a")]), true);
	assert.equal(toolResultsMatch(["a"], []), false);
	assert.equal(toolResultsMatch(["a"], [r("b")]), false);
	assert.equal(toolResultsMatch(["a"], [r("a"), r("b")]), false);
	assert.equal(toolResultsMatch(["a", "b"], [r("a"), r("a")]), false);
});

// ============================================================================
// Continue
// ============================================================================

const RESULT = [{ toolCallId: "c1", content: '{"status":"shipped"}' }];

const continueWith = (
	redis: FakeRedis,
	continuationId: string,
	deps: ToolLoopDeps<number>,
	toolResults = RESULT,
	caller = OWNER,
) =>
	drain(
		continueToolTurn({
			redis,
			continuationId,
			toolResults,
			caller,
			deps,
			leadEvents: (state) => [{ type: "sources" as const, data: state.sources }],
			now: () => new Date(redis.now),
		}),
	);

test("continue: answers from the stored turn, then the continuation is used up", async () => {
	const { redis, continuationId } = await saved();
	const { deps, requests } = fakeDeps([{ text: "It shipped." }], redis);
	const { events, outcome } = await continueWith(redis, continuationId, deps);
	assert.deepEqual(sequence(events), ["sources", "token", "usage"]);
	assert.deepEqual(events[0], { type: "sources", data: [{ documentId: "d1" }] });
	assert.equal(outcome.finishReason, "stop");
	assert.deepEqual(requests[0].input.at(-1), {
		type: "function_call_output",
		callId: "c1",
		output: '{"status":"shipped"}',
	});
	await assert.rejects(continueWith(redis, continuationId, deps), { code: "NOT_FOUND" });
});

test("continue: unknown, expired and foreign continuations are the same 404", async () => {
	const { redis, continuationId } = await saved();
	const { deps } = fakeDeps([], redis);
	const errors: unknown[] = [];
	for (const [id, caller] of [
		["nope", OWNER],
		[continuationId, { ...OWNER, apiKeyId: "key-2" }],
		[continuationId, { ...OWNER, apiKeyProfileId: "kb-2" }],
	] as const) {
		await continueWith(redis, id, deps, RESULT, caller).catch((err: unknown) =>
			errors.push(err),
		);
	}
	redis.now += CONTINUATION_TTL_SECONDS * 1000;
	await continueWith(redis, continuationId, deps).catch((err: unknown) => errors.push(err));
	assert.equal(errors.length, 4);
	for (const err of errors) {
		assert.ok(err instanceof ORPCError);
		assert.equal(err.code, "NOT_FOUND");
		assert.equal(err.message, "Continuation not found");
	}
});

test("continue: results that do not match the pending calls are a 400, the turn is kept", async () => {
	const { redis, continuationId } = await saved();
	const { deps, requests } = fakeDeps([{ text: "It shipped." }], redis);
	for (const results of [
		[],
		[{ toolCallId: "other", content: "x" }],
		[...RESULT, ...RESULT],
	]) {
		await assert.rejects(continueWith(redis, continuationId, deps, results), {
			code: "BAD_REQUEST",
		});
	}
	assert.equal(requests.length, 0);
	// The client fixes its request and goes on
	const { outcome } = await continueWith(redis, continuationId, deps);
	assert.equal(outcome.finishReason, "stop");
});

test("continue: no credits is a 403 before any call; the turn is kept for a retry", async () => {
	const { redis, continuationId } = await saved();
	const { deps, requests } = fakeDeps([{ text: "It shipped." }], redis);
	deps.reserveError = new ORPCError("FORBIDDEN", { message: "Insufficient credits" });
	await assert.rejects(continueWith(redis, continuationId, deps), { code: "FORBIDDEN" });
	assert.equal(requests.length, 0);
	delete deps.reserveError;
	const { outcome } = await continueWith(redis, continuationId, deps);
	assert.equal(outcome.answer, "It shipped.");
});

test("continue: a provider rejection keeps the turn; a failure after acceptance does not", async () => {
	const rejected = await saved();
	const a = fakeDeps([{ reject: true }, { text: "It shipped." }], rejected.redis);
	await assert.rejects(continueWith(rejected.redis, rejected.continuationId, a.deps));
	assert.equal(a.settles[0].providerCalled, false);
	const retried = await continueWith(rejected.redis, rejected.continuationId, a.deps);
	assert.equal(retried.outcome.finishReason, "stop");

	const broken = await saved();
	const b = fakeDeps([{ failAfterAccept: true }], broken.redis);
	await assert.rejects(continueWith(broken.redis, broken.continuationId, b.deps));
	assert.equal(b.settles[0].providerCalled, true);
	await assert.rejects(continueWith(broken.redis, broken.continuationId, b.deps), {
		code: "NOT_FOUND",
	});
});

test("continue: a restored turn keeps its original expiry", async () => {
	const { redis, continuationId } = await saved();
	const { deps } = fakeDeps([], redis);
	redis.now += 10 * 60 * 1000;
	await assert.rejects(continueWith(redis, continuationId, deps, []), { code: "BAD_REQUEST" });
	assert.equal(redis.ttls.at(-1), CONTINUATION_TTL_SECONDS - 10 * 60);
});

// ============================================================================
// Routes
// ============================================================================

test("chat-only keys reach the continue routes (chatProcedure), nothing else new", () => {
	// Route modules load the env and database, so the chain is read from the source
	const source = readFileSync(
		path.resolve(__dirname, "../router/routes/chat.routes.ts"),
		"utf8",
	);
	const procedures = Object.fromEntries(
		[...source.matchAll(/^\t(\w+): (\w+)\n\t\t\.route/gm)].map((m) => [m[1], m[2]]),
	);
	assert.deepEqual(procedures, {
		query: "chatProcedure",
		search: "chatProcedure",
		queryStream: "chatProcedure",
		continue: "chatProcedure",
		continueStream: "chatProcedure",
		getModels: "publicProcedure",
	});
	// Requests never carry tool definitions
	assert.equal(/\btools\s*:/.test(source.slice(0, source.indexOf("export const chatRoutes"))), false);
});

// ============================================================================
// Provider stream (Responses events, mocked)
// ============================================================================

const events = async function* (list: Record<string, unknown>[]) {
	yield* list;
};

const completedResponse = (output: Record<string, unknown>[], extra = {}) => ({
	type: "response.completed",
	response: { output, usage: { inputTokens: 50, outputTokens: 7 }, ...extra },
});

test("provider stream: text deltas, then the calls and usage of response.completed", async () => {
	const call = {
		type: "function_call",
		id: "fc_1",
		callId: "call_1",
		name: "lookup_order",
		arguments: '{"orderId":"A-1"}',
	};
	const { events: out } = await drain(
		readToolTurnStream(
			events([
				{ type: "response.created", response: {} },
				{ type: "response.output_text.delta", delta: "Checking" },
				{ type: "response.function_call_arguments.delta", delta: '{"orderId"' },
				{ type: "response.output_text.delta", delta: "" },
				completedResponse([{ type: "reasoning", id: "rs_1" }, call]),
			]),
		),
	);
	assert.deepEqual(out, [
		{ type: "text", delta: "Checking" },
		{
			type: "completed",
			output: [{ type: "reasoning", id: "rs_1" }, call],
			toolCalls: [{ id: "call_1", name: "lookup_order", arguments: '{"orderId":"A-1"}' }],
			usage: { inputTokens: 50, outputTokens: 7, totalTokens: 57 },
			finishReason: undefined,
		},
	]);
});

test("provider stream: events and items the SDK could not parse are read from the raw JSON", async () => {
	const call = {
		type: "function_call",
		id: "fc_1",
		call_id: "call_1",
		name: "lookup_order",
		arguments: "{}",
	};
	const { events: out } = await drain(
		readToolTurnStream(
			events([
				{ type: "UNKNOWN", isUnknown: true, raw: { type: "response.output_text.delta", delta: "Hi" } },
				{
					type: "UNKNOWN",
					isUnknown: true,
					raw: {
						type: "response.completed",
						response: {
							output: [{ type: "reasoning", id: "rs_1", encrypted_content: "e" }, call],
							usage: { input_tokens: 9, output_tokens: 3 },
						},
					},
				},
			]),
		),
	);
	assert.deepEqual(out, [
		{ type: "text", delta: "Hi" },
		{
			type: "completed",
			output: [
				{ type: "reasoning", id: "rs_1", encryptedContent: "e" },
				{ type: "function_call", id: "fc_1", callId: "call_1", name: "lookup_order", arguments: "{}" },
			],
			toolCalls: [{ id: "call_1", name: "lookup_order", arguments: "{}" }],
			usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
			finishReason: undefined,
		},
	]);

	// A known response with one unknown item: only that item is read raw
	const mixed = await drain(
		readToolTurnStream(
			events([completedResponse([{ type: "UNKNOWN", isUnknown: true, raw: call }])]),
		),
	);
	const completed = mixed.events[0];
	assert.ok(completed.type === "completed");
	assert.deepEqual(completed.toolCalls, [{ id: "call_1", name: "lookup_order", arguments: "{}" }]);
});

test("provider stream: an incomplete response completes with its reason", async () => {
	const { events: out } = await drain(
		readToolTurnStream(
			events([
				{
					type: "response.incomplete",
					response: {
						output: [],
						usage: null,
						incompleteDetails: { reason: "max_output_tokens" },
					},
				},
			]),
		),
	);
	assert.deepEqual(out, [
		{
			type: "completed",
			output: [],
			toolCalls: [],
			usage: null,
			finishReason: "max_output_tokens",
		},
	]);
});

test("provider stream: failure, error event and early end throw without echoing content", async () => {
	const secret = "jane.doe@example.com";
	for (const list of [
		[{ type: "response.failed", response: { error: { code: "server_error", message: secret } } }],
		[{ type: "error", code: "rate_limited", message: secret }],
		[{ type: "response.output_text.delta", delta: secret }],
	]) {
		await assert.rejects(drain(readToolTurnStream(events(list))), (err: unknown) => {
			assert.ok(err instanceof Error);
			assert.equal(err.message.includes(secret), false);
			return true;
		});
	}
});
