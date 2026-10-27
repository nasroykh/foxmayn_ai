import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createRedisRateLimitStorage,
	type RateLimitRedis,
} from "./rate-limit-storage";

const createFakeRedis = () => {
	const counts = new Map<string, number>();
	const ttls = new Map<string, number>();
	const redis: RateLimitRedis = {
		incr: async (key) => {
			const next = (counts.get(key) ?? 0) + 1;
			counts.set(key, next);
			return next;
		},
		expire: async (key, seconds) => {
			ttls.set(key, seconds);
			return 1;
		},
		ttl: async (key) => ttls.get(key) ?? -1,
	};
	return { redis, ttls };
};

test("allows up to max then blocks with retryAfter", async () => {
	const { redis } = createFakeRedis();
	const storage = createRedisRateLimitStorage(redis);
	const rule = { window: 10, max: 2 };

	assert.deepEqual(await storage.consume("ip/path", rule), {
		allowed: true,
		retryAfter: null,
	});
	assert.equal((await storage.consume("ip/path", rule)).allowed, true);
	assert.deepEqual(await storage.consume("ip/path", rule), {
		allowed: false,
		retryAfter: 10,
	});
});

test("first hit sets the window TTL", async () => {
	const { redis, ttls } = createFakeRedis();
	await createRedisRateLimitStorage(redis).consume("k", { window: 60, max: 5 });
	assert.equal(ttls.get("auth:rl:k"), 60);
});

test("fails open when redis throws", async () => {
	const storage = createRedisRateLimitStorage({
		incr: async () => {
			throw new Error("down");
		},
		expire: async () => 1,
		ttl: async () => -1,
	});
	assert.deepEqual(await storage.consume("k", { window: 10, max: 1 }), {
		allowed: true,
		retryAfter: null,
	});
});
