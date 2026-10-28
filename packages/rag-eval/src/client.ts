import { postJson, type FetchLike, type RetryOptions } from "./http";

/** A retrieved chunk, as /chat/search and /chat/query return it. */
export interface Passage {
	source: string | null;
	title: string;
	content: string;
	score: number;
}

export interface Usage {
	inputTokens: number;
	outputTokens: number;
}

export interface QueryResponse {
	answer: string;
	sources: Passage[];
	usage?: Usage;
	finishReason?: "stop" | "tool_calls";
	toolCalls?: { name: string }[];
}

export interface SearchOptions {
	sourcePrefix?: string;
	limit?: number;
}

/**
 * Client of a deployed Foxmayn AI (HTTP only). A chat-only key is enough:
 * the key's knowledge base is used.
 */
export const createFoxmaynClient = (config: {
	baseUrl: string;
	apiKey: string;
	fetch: FetchLike;
	retry?: RetryOptions;
}) => {
	const base = `${config.baseUrl.replace(/\/+$/, "")}/api/v1`;
	const headers = { "x-api-key": config.apiKey };
	const post = (path: string, body: unknown) =>
		postJson(config.fetch, `${base}${path}`, headers, body, config.retry);

	return {
		async search(query: string, options: SearchOptions): Promise<Passage[]> {
			const body = (await post("/chat/search", { query, options })) as {
				results?: Passage[];
			};
			return body.results ?? [];
		},
		/** Client-managed history (empty), so no conversation is stored. */
		async query(query: string, options: SearchOptions): Promise<QueryResponse> {
			return (await post("/chat/query", {
				query,
				messages: [],
				options,
			})) as QueryResponse;
		},
	};
};

export type FoxmaynClient = ReturnType<typeof createFoxmaynClient>;
