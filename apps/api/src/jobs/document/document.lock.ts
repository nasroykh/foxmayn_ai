import { randomUUID } from "node:crypto";

/** Minimal Redis surface the lock needs (lets tests use an in-memory fake). */
export interface LockClient {
	set(
		key: string,
		value: string,
		px: "PX",
		ms: number,
		nx: "NX",
	): Promise<unknown>;
	eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

// Expires on its own when the worker dies; renewed while the job runs
const LOCK_TTL_MS = 2 * 60 * 1000;
const RENEW_INTERVAL_MS = 30 * 1000;

const lockKey = (documentId: string) => `lock:document:${documentId}`;

// Compare-and-delete / compare-and-extend: only the holder's token matches
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
	return redis.call("del", KEYS[1])
end
return 0`;
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
	return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0`;

export interface DocumentLock {
	release: () => Promise<void>;
}

/**
 * Take the per-document lock (SET NX PX with a random token).
 * Returns null when another job holds it. The lock is renewed in the
 * background until `release` is called.
 */
export async function acquireDocumentLock(
	documentId: string,
	client: LockClient,
	options: { ttlMs?: number; renewMs?: number } = {},
): Promise<DocumentLock | null> {
	const ttlMs = options.ttlMs ?? LOCK_TTL_MS;
	const renewMs = options.renewMs ?? RENEW_INTERVAL_MS;
	const key = lockKey(documentId);
	const token = randomUUID();

	const ok = await client.set(key, token, "PX", ttlMs, "NX");
	if (ok !== "OK") return null;

	const timer = setInterval(() => {
		client
			.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs))
			.catch((err) =>
				console.error(`[Document Lock] Failed to renew ${documentId}:`, err),
			);
	}, renewMs);
	timer.unref();

	return {
		release: async () => {
			clearInterval(timer);
			await client
				.eval(RELEASE_SCRIPT, 1, key, token)
				.catch((err) =>
					console.error(`[Document Lock] Failed to release ${documentId}:`, err),
				);
		},
	};
}
