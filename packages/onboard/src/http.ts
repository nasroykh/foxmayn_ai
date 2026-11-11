export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RetryOptions {
	retries: number;
	baseDelayMs: number;
	sleep: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const defaultRetry: RetryOptions = { retries: 3, baseDelayMs: 1000, sleep: defaultSleep };

/** An HTTP failure. The message never holds request headers or bodies. */
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

export interface Client {
	request: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

/**
 * JSON client of one deployment. Keeps the session cookies in memory only,
 * sends the Origin header the API trusts, retries 429, 5xx and network errors.
 */
export const createClient = (options: {
	baseUrl: string;
	fetch: FetchLike;
	retry?: RetryOptions;
}): Client => {
	const base = options.baseUrl.replace(/\/+$/, "");
	const origin = new URL(base).origin;
	const retry = options.retry ?? defaultRetry;
	const jar = new Map<string, string>();

	const remember = (response: Response) => {
		for (const line of response.headers.getSetCookie?.() ?? []) {
			const pair = line.split(";")[0] ?? "";
			const eq = pair.indexOf("=");
			if (eq <= 0) continue;
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			if (value === "") jar.delete(name);
			else jar.set(name, value);
		}
	};

	const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
		for (let attempt = 0; ; attempt++) {
			const headers: Record<string, string> = { origin };
			if (body !== undefined) headers["content-type"] = "application/json";
			if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
			let response: Response;
			try {
				response = await options.fetch(`${base}${path}`, {
					method,
					headers,
					body: body === undefined ? undefined : JSON.stringify(body),
				});
			} catch (err) {
				if (attempt >= retry.retries) {
					throw new HttpError(0, `Network error: ${err instanceof Error ? err.message : String(err)}`);
				}
				await retry.sleep(retry.baseDelayMs * 2 ** attempt);
				continue;
			}
			remember(response);
			if (response.ok) {
				const text = await response.text();
				return text ? (JSON.parse(text) as unknown) : null;
			}
			if (retryable(response.status) && attempt < retry.retries) {
				await retry.sleep(retry.baseDelayMs * 2 ** attempt);
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

	return { request };
};
