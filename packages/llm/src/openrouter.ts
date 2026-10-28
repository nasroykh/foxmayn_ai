import { OpenRouter } from "@openrouter/sdk";
import { env } from "./config/env";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "./data/openrouter_models";
import { describeError } from "./redact";
type Reasoning = { effort: "xhigh" | "high" | "medium" | "low" | "minimal" | "none" | null | undefined };

// Whole-request ceiling, including the streamed body. Long enough for slow
// reasoning models, short enough that a hung upstream frees the worker slot.
const REQUEST_TIMEOUT_MS = 180_000;

let client: OpenRouter | undefined;

/**
 * Lazily builds the OpenRouter client so that importing this module never
 * throws (the API/worker can boot and report a clear error on first use).
 */
function getClient(): OpenRouter {
	if (client) return client;

	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (!apiKey) {
		throw new Error(
			"OPENROUTER_API_KEY is not set. Set it in .env to use chat and document embedding.",
		);
	}

	client = new OpenRouter({
		apiKey,
		appTitle: "Foxmayn AI",
		httpReferer: env.APP_URL || "https://foxmayn.ai",
		timeoutMs: REQUEST_TIMEOUT_MS,
		retryConfig: {
			strategy: "backoff",
			backoff: {
				initialInterval: 500,
				maxInterval: 5_000,
				exponent: 2,
				maxElapsedTime: 20_000,
			},
			retryConnectionErrors: true,
		},
	});
	return client;
}

export type AIModelId = (typeof OPENROUTER_AI_MODELS)[number]["id"];
export type EmbeddingModelId =
	(typeof OPENROUTER_EMBEDDING_MODELS)[number]["id"];

/**
 * Embedding model of a profile that does not choose one. The `rag_profile`
 * column default in @repo/db must stay equal (a test in the API checks it).
 */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelId =
	"openai/text-embedding-3-small";

// ============================================================================
// Usage tracking types
// ============================================================================

export type AIUsage = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
};

export type QueryResultWithUsage = {
	text: string;
	usage: AIUsage;
	// Why the response is incomplete (e.g. "max_output_tokens"), when it is
	finishReason?: string;
};

export type StreamQueryResultWithUsage = {
	stream: AsyncIterable<string>;
	getUsage: () => Promise<AIUsage>;
};

export type EmbedResultWithUsage = {
	embeddings: number[][];
	usage: { totalTokens: number };
};

// ============================================================================
// AI Settings
// ============================================================================

type AISettings = {
	model: AIModelId | (string & {});
	temperature: number;
	topP?: number;
	maxTokens: number;
	reasoning: Reasoning["effort"];
	stream?: boolean;
};

const DEFAULT_AI_SETTINGS: AISettings = {
	model: "google/gemini-2.5-flash-lite",
	temperature: 1.0,
	maxTokens: 500,
	reasoning: "none" satisfies Reasoning["effort"],
	topP: 1.0,
} as const;

// ============================================================================
// OpenRouterQuery — returns usage alongside response
// ============================================================================

/**
 * Query an LLM via OpenRouter.
 *
 * - Non-streaming (`stream: false`): returns `QueryResultWithUsage`
 * - Streaming (`stream: true`): returns `StreamQueryResultWithUsage`
 */
export function OpenRouterQuery(
	settings: AISettings & { stream: true },
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
): StreamQueryResultWithUsage;
export function OpenRouterQuery(
	settings: AISettings & { stream?: false | undefined },
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
): Promise<QueryResultWithUsage>;
export function OpenRouterQuery(
	settings: AISettings,
	chatHistory?: { role: "system" | "user" | "assistant"; content: string }[],
	systemPrompt?: string,
	prompt?: string,
): Promise<QueryResultWithUsage> | StreamQueryResultWithUsage {
	const messages = chatHistory && chatHistory.length ? [...chatHistory] : [];

	if (!prompt || !prompt.trim()) throw new Error("Prompt is required");

	if (systemPrompt && systemPrompt.trim()) {
		messages.unshift({ role: "system", content: systemPrompt });
	}

	messages.push({ role: "user", content: prompt });

	if (
		settings.temperature &&
		(settings.temperature < 0 || settings.temperature > 2)
	) {
		throw new Error("Temperature must be between 0 and 2");
	}

	if (settings.maxTokens && settings.maxTokens <= 0) {
		throw new Error("Max tokens must be greater than 0");
	}

	if (settings.topP && (settings.topP < 0 || settings.topP > 1)) {
		throw new Error("Top P must be between 0 and 1");
	}

	const callResult = getClient().callModel({
		input: messages,
		model: settings.model || DEFAULT_AI_SETTINGS.model,
		temperature: settings.temperature ?? DEFAULT_AI_SETTINGS.temperature,
		topP: settings.topP ?? DEFAULT_AI_SETTINGS.topP,
		maxOutputTokens: settings.maxTokens || DEFAULT_AI_SETTINGS.maxTokens,
		reasoning: {
			enabled: settings.reasoning
				? settings.reasoning !== "none"
				: DEFAULT_AI_SETTINGS.reasoning !== "none",
			effort: settings.reasoning || DEFAULT_AI_SETTINGS.reasoning,
		},
	});

	if (settings.stream) {
		// Streaming: return stream + deferred usage getter
		const stream = callResult.getTextStream();

		const getUsage = async (): Promise<AIUsage> => {
			try {
				const response = await callResult.getResponse();
				return {
					inputTokens: response.usage?.inputTokens ?? 0,
					outputTokens: response.usage?.outputTokens ?? 0,
					totalTokens:
						(response.usage?.inputTokens ?? 0) +
						(response.usage?.outputTokens ?? 0),
				};
			} catch (error) {
				console.error(
					"[OpenRouter] Failed to retrieve usage data after stream — token counts will be zero and billing may be inaccurate:",
					describeError(error),
				);
				return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
			}
		};

		return { stream, getUsage };
	}

	// Non-streaming: await full response with usage
	return (async (): Promise<QueryResultWithUsage> => {
		try {
			const response = await callResult.getResponse();
			const text = await callResult.getText();

			return {
				text: text || "",
				finishReason: response.incompleteDetails?.reason ?? undefined,
				usage: {
					inputTokens: response.usage?.inputTokens ?? 0,
					outputTokens: response.usage?.outputTokens ?? 0,
					totalTokens:
						(response.usage?.inputTokens ?? 0) +
						(response.usage?.outputTokens ?? 0),
				},
			};
		} catch (error) {
			console.error("[OpenRouter] Query failed:", describeError(error));
			throw error;
		}
	})();
}

// ============================================================================
// OpenRouterToolTurn — one streamed model call that may request tool calls
// ============================================================================

/** A function the model may call. `parameters` is sent exactly as written. */
export type ToolDefinition = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

/**
 * One item of the model input in Responses API format: a message
 * (`{ role, content }`), a call result (`{ type: "function_call_output",
 * callId, output }`), or an output item of an earlier call, replayed as
 * returned (reasoning and function calls included).
 */
export type ToolTurnItem = Record<string, unknown>;

export type ToolCallRequest = { id: string; name: string; arguments: string };

export type ToolTurnEvent =
	// The provider answered the request (HTTP 200): from here on the call is billed
	| { type: "accepted" }
	| { type: "text"; delta: string }
	| {
			type: "completed";
			// Output items, to replay in the next call's input
			output: ToolTurnItem[];
			toolCalls: ToolCallRequest[];
			usage: AIUsage | null;
			// Why the response is incomplete (e.g. "max_output_tokens"), when it is
			finishReason?: string;
	  };

type StreamEvent = { type: string; [k: string]: unknown };

const camelCase = (key: string): string =>
	key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Wire (snake_case) JSON to the SDK's camelCase shape. */
const camelizeKeys = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(camelizeKeys)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.entries(value).map(([k, v]) => [camelCase(k), camelizeKeys(v)]),
				)
			: value;

/**
 * The SDK turns an event or item its schema does not know (e.g. a field
 * OpenRouter added or dropped) into `{ type: "UNKNOWN", raw }` instead of
 * throwing. Read those from the raw wire JSON so schema drift does not break
 * every call.
 */
const known = <T>(value: T): T => {
	const v = value as { type?: unknown; raw?: unknown } | null;
	return v && v.type === "UNKNOWN" && v.raw && typeof v.raw === "object"
		? (camelizeKeys(v.raw) as T)
		: value;
};
type CompletedResponse = {
	output?: ToolTurnItem[];
	usage?: { inputTokens?: number; outputTokens?: number } | null;
	incompleteDetails?: { reason?: string | null } | null;
	error?: { code?: string | null } | null;
};

/**
 * Streams one model call with function tools the caller runs itself (nothing
 * is executed here). Uses the Responses endpoint directly so tool schemas are
 * sent as written, at most one call per turn (parallel tool calls off).
 *
 * Yields text deltas, then one `completed` event with the output items, the
 * requested calls and the usage of `response.completed`. A stream that fails
 * or ends without completing throws. Events are never logged: they carry the
 * call arguments.
 */
export async function* OpenRouterToolTurn(
	settings: Omit<AISettings, "stream">,
	input: ToolTurnItem[],
	tools: ToolDefinition[],
	toolChoice: "auto" | "none",
): AsyncGenerator<ToolTurnEvent> {
	if (input.length === 0) throw new Error("Input is required");

	const stream = await getClient().responses.send({
		responsesRequest: {
			// Our items are valid Responses input; the SDK validates them on send
			input: input as never,
			model: settings.model || DEFAULT_AI_SETTINGS.model,
			temperature: settings.temperature ?? DEFAULT_AI_SETTINGS.temperature,
			topP: settings.topP ?? DEFAULT_AI_SETTINGS.topP,
			maxOutputTokens: settings.maxTokens || DEFAULT_AI_SETTINGS.maxTokens,
			reasoning: {
				enabled: settings.reasoning
					? settings.reasoning !== "none"
					: DEFAULT_AI_SETTINGS.reasoning !== "none",
				effort: settings.reasoning || DEFAULT_AI_SETTINGS.reasoning,
			},
			...(tools.length > 0 && {
				tools: tools.map((t) => ({
					type: "function" as const,
					name: t.name,
					description: t.description,
					parameters: t.parameters,
					strict: null,
				})),
				toolChoice,
				parallelToolCalls: false,
			}),
			stream: true,
		},
	});

	yield { type: "accepted" };
	yield* readToolTurnStream(stream);
}

/**
 * Turns Responses stream events into text deltas and one `completed` event.
 * Throws on a failed response, an error event, or a stream that ends early.
 */
export async function* readToolTurnStream(
	stream: AsyncIterable<unknown>,
): AsyncGenerator<ToolTurnEvent> {
	for await (const raw of stream) {
		const event = known(raw) as StreamEvent;
		switch (event.type) {
			case "response.output_text.delta":
				if (typeof event.delta === "string" && event.delta) {
					yield { type: "text", delta: event.delta };
				}
				break;
			case "response.completed":
			case "response.incomplete": {
				const response = event.response as CompletedResponse;
				const output = (response.output ?? []).map(known);
				const inputTokens = response.usage?.inputTokens ?? 0;
				const outputTokens = response.usage?.outputTokens ?? 0;
				yield {
					type: "completed",
					output,
					toolCalls: output
						.filter((item) => item.type === "function_call")
						.map((item) => ({
							id: String(item.callId),
							name: String(item.name),
							arguments: typeof item.arguments === "string" ? item.arguments : "",
						})),
					usage: response.usage
						? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
						: null,
					finishReason: response.incompleteDetails?.reason ?? undefined,
				};
				return;
			}
			case "response.failed": {
				const response = event.response as CompletedResponse;
				throw new Error(
					`Model response failed (${response.error?.code ?? "unknown"})`,
				);
			}
			case "error":
				throw new Error(`Model stream error (${String(event.code ?? "unknown")})`);
		}
	}
	throw new Error("Model stream ended before the response completed");
}

// ============================================================================
// OpenRouterEmbed — returns usage alongside embeddings
// ============================================================================

/**
 * Batch embedding with usage tracking.
 *
 * @param model - Embedding model to use
 * @param chunks - Array of text chunks to embed
 * @returns Embeddings array + token usage
 */
export const OpenRouterEmbed = async (
	model: EmbeddingModelId | (string & {}),
	chunks: string[],
): Promise<EmbedResultWithUsage> => {
	if (!chunks.length) throw new Error("Chunks are required");

	try {
		const dimensions = OPENROUTER_EMBEDDING_MODELS.find(
			(m) => m.id === model,
		)?.dimensions;

		if (!dimensions) throw new Error("Invalid model");

		const response = await getClient().embeddings.generate({
			requestBody: {
				model,
				input: chunks,
				encodingFormat: "float",
				dimensions,
			},
		});

		if (typeof response !== "object" || !response || !("data" in response)) {
			throw new Error("Invalid response from OpenRouter embedding generation");
		}

		if (!response.data?.length) {
			throw new Error("No embeddings returned from batch completion");
		}

		const sorted = response.data.sort(
			(a, b) => (a.index ?? 0) - (b.index ?? 0),
		);

		const embeddings = sorted.map((item) => {
			if (typeof item.embedding === "string") {
				throw new Error("Received string embedding but expected float");
			}
			return item.embedding;
		});

		// The SDK maps the wire's snake_case usage to camelCase
		const usage = response.usage;

		return {
			embeddings,
			usage: {
				totalTokens: usage?.totalTokens ?? usage?.promptTokens ?? 0,
			},
		};
	} catch (error) {
		console.error("[OpenRouter] Batch embedding error:", describeError(error));
		throw error;
	}
};
