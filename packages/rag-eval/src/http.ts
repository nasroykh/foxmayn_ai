export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RetryOptions {
	// Retries after the first attempt
	retries: number;
	baseDelayMs: number;
	sleep: (ms: number) => Promise<void>;
}

export const defaultRetry: RetryOptions = {
	retries: 3,
	baseDelayMs: 1000,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** An HTTP failure. The message never holds request headers (API keys). */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

const retryable = (status: number) => status === 429 || status >= 500;

/** Wait before the next attempt: Retry-After when the server sets it, else backoff. */
const delayFor = (response: Response | null, attempt: number, base: number): number => {
	const after = Number(response?.headers.get("retry-after"));
	if (Number.isFinite(after) && after > 0) return Math.min(after, 60) * 1000;
	return base * 2 ** attempt;
};

/**
 * POSTs JSON and returns the parsed body. Retries 429, 5xx and network errors
 * up to `retries` times with exponential backoff; other statuses fail at once.
 */
export const postJson = async (
	fetchImpl: FetchLike,
	url: string,
	headers: Record<string, string>,
	body: unknown,
	retry: RetryOptions = defaultRetry,
): Promise<unknown> => {
	for (let attempt = 0; ; attempt++) {
		let response: Response;
		try {
			response = await fetchImpl(url, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify(body),
			});
		} catch (err) {
			if (attempt >= retry.retries) {
				throw new HttpError(0, `Network error: ${err instanceof Error ? err.message : String(err)}`);
			}
			await retry.sleep(delayFor(null, attempt, retry.baseDelayMs));
			continue;
		}
		if (response.ok) return response.json();
		if (retryable(response.status) && attempt < retry.retries) {
			await retry.sleep(delayFor(response, attempt, retry.baseDelayMs));
			continue;
		}
		const text = await response.text().catch(() => "");
		let message = text;
		try {
			const parsed = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } };
			message = String(parsed.message ?? parsed.error?.message ?? text);
		} catch {
			// Not JSON: keep the text
		}
		throw new HttpError(response.status, `HTTP ${response.status}: ${message.slice(0, 200)}`);
	}
};
