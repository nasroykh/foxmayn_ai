import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireDocumentLock, type LockClient } from "./document.lock";

/** In-memory stand-in for the three Redis operations the lock uses. */
const fakeRedis = () => {
	const store = new Map<string, string>();
	const client: LockClient = {
		async set(key, value, _px, _ms, _nx) {
			if (store.has(key)) return null;
			store.set(key, value);
			return "OK";
		},
		async eval(script, _numKeys, key, token) {
			if (store.get(key) !== token) return 0;
			if (script.includes('"del"')) store.delete(key);
			return 1;
		},
	};
	return { store, client };
};

test("second acquire fails while the lock is held", async () => {
	const { client } = fakeRedis();
	const first = await acquireDocumentLock("doc-1", client);
	assert.ok(first);
	assert.equal(await acquireDocumentLock("doc-1", client), null);
	await first.release();
});

test("different documents do not block each other", async () => {
	const { client } = fakeRedis();
	const a = await acquireDocumentLock("doc-a", client);
	const b = await acquireDocumentLock("doc-b", client);
	assert.ok(a && b);
	await a.release();
	await b.release();
});

test("lock can be taken again after release", async () => {
	const { client } = fakeRedis();
	const first = await acquireDocumentLock("doc-1", client);
	await first!.release();
	const second = await acquireDocumentLock("doc-1", client);
	assert.ok(second);
	await second.release();
});

test("release never deletes a lock held by another token", async () => {
	const { client, store } = fakeRedis();
	const first = await acquireDocumentLock("doc-1", client);
	assert.ok(first);
	// Simulate TTL expiry and another worker taking the lock
	store.set("lock:document:doc-1", "other-token");
	await first.release();
	assert.equal(store.get("lock:document:doc-1"), "other-token");
});
