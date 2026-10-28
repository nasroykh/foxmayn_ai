import type { FetchLike, RetryOptions } from "./http";

// Test helpers (no network)

export const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

/** Retries without waiting; records the delays. */
export const noWait: RetryOptions & { delays: number[] } = {
	retries: 3,
	baseDelayMs: 1000,
	delays: [],
	sleep: async (ms) => {
		noWait.delays.push(ms);
	},
};

/** A fetch that answers with `handler` and records every call. */
export const mockFetch = (
	handler: (url: string, body: Record<string, unknown>) => Response | Promise<Response>,
) => {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch: FetchLike = async (url, init) => {
		calls.push({ url, init });
		return handler(url, JSON.parse(String(init.body)) as Record<string, unknown>);
	};
	return { fetch, calls };
};
