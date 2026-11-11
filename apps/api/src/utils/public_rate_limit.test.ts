import { test } from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/server";
import type { RateLimitRedis } from "../config/rate-limit-storage";
import {
	PUBLIC_CHAT_IP_LIMIT,
	PUBLIC_CHAT_SITE_LIMIT,
	enforcePublicChatLimits,
	ipBucket,
} from "./public_rate_limit";

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
	return { redis, counts, ttls };
};

const silenceErrors = () => {
	const original = console.error;
	console.error = () => {};
	return () => {
		console.error = original;
	};
};

test("limits are 20 per IP per 10 minutes and 500 per site per day", () => {
	assert.deepEqual(PUBLIC_CHAT_IP_LIMIT, { window: 600, max: 20 });
	assert.deepEqual(PUBLIC_CHAT_SITE_LIMIT, { window: 86_400, max: 500 });
});

test("allows requests under the limits and sets the window TTLs", async () => {
	const { redis, ttls } = createFakeRedis();
	for (let i = 0; i < PUBLIC_CHAT_IP_LIMIT.max; i++) {
		await enforcePublicChatLimits(redis, "2mp.foxmayn.com", "203.0.113.9");
	}
	assert.equal(ttls.get("public:rl:ip:2mp.foxmayn.com:203.0.113.9"), 600);
	assert.equal(ttls.get("public:rl:site:2mp.foxmayn.com"), 86_400);
});

test("over the IP limit: 429 with the wait, in the API key rate limit shape", async () => {
	const { redis, counts } = createFakeRedis();
	for (let i = 0; i < PUBLIC_CHAT_IP_LIMIT.max; i++) {
		await enforcePublicChatLimits(redis, "h.example.com", "1.1.1.1");
	}
	await assert.rejects(
		enforcePublicChatLimits(redis, "h.example.com", "1.1.1.1"),
		(error) => {
			assert.ok(error instanceof ORPCError);
			assert.equal(error.status, 429);
			assert.equal(error.code, "TOO_MANY_REQUESTS");
			assert.deepEqual(error.data, { code: "RATE_LIMITED", retryAfterSeconds: 600 });
			return true;
		},
	);
	// A blocked visitor does not use up the site's daily budget
	assert.equal(counts.get("public:rl:site:h.example.com"), PUBLIC_CHAT_IP_LIMIT.max);
	// Another IP is not affected
	await enforcePublicChatLimits(redis, "h.example.com", "2.2.2.2");
});

test("the IP limit is per hostname", async () => {
	const { redis } = createFakeRedis();
	for (let i = 0; i < PUBLIC_CHAT_IP_LIMIT.max; i++) {
		await enforcePublicChatLimits(redis, "a.example.com", "1.1.1.1");
	}
	await enforcePublicChatLimits(redis, "b.example.com", "1.1.1.1");
});

test("over the site limit: 429 with the day window", async () => {
	const { redis, counts } = createFakeRedis();
	counts.set("public:rl:site:h.example.com", PUBLIC_CHAT_SITE_LIMIT.max);
	await assert.rejects(
		enforcePublicChatLimits(redis, "h.example.com", "9.9.9.9"),
		(error) => {
			assert.ok(error instanceof ORPCError);
			assert.equal(error.status, 429);
			assert.deepEqual(error.data, { code: "RATE_LIMITED", retryAfterSeconds: 86_400 });
			return true;
		},
	);
});

test("fails closed when Redis errors", async () => {
	const restore = silenceErrors();
	try {
		const broken: RateLimitRedis = {
			incr: async () => {
				throw new Error("ECONNREFUSED");
			},
			expire: async () => 1,
			ttl: async () => -1,
		};
		await assert.rejects(
			enforcePublicChatLimits(broken, "h.example.com", "1.1.1.1"),
			(error) => {
				assert.ok(error instanceof ORPCError);
				assert.equal(error.status, 503);
				assert.equal(error.code, "SERVICE_UNAVAILABLE");
				return true;
			},
		);

		// Also when it fails after the first hit (EXPIRE)
		const flaky: RateLimitRedis = {
			incr: async () => 1,
			expire: async () => {
				throw new Error("timeout");
			},
			ttl: async () => -1,
		};
		await assert.rejects(
			enforcePublicChatLimits(flaky, "h.example.com", "1.1.1.1"),
			(error) => error instanceof ORPCError && error.status === 503,
		);
	} finally {
		restore();
	}
});

test("ipBucket: IPv4 unchanged, mapped IPv4 is IPv4, IPv6 is a /64, invalid stays", () => {
	assert.equal(ipBucket("203.0.113.9"), "203.0.113.9");
	assert.equal(ipBucket("::ffff:203.0.113.9"), "203.0.113.9");
	const a = ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
	assert.equal(a, "2001:db8:1:2::/64");
	assert.equal(ipBucket("2001:DB8:1:2::1"), a);
	assert.equal(ipBucket("2001:db8:1:3::1"), "2001:db8:1:3::/64");
	assert.equal(ipBucket("2001:db8::1"), "2001:db8:0:0::/64");
	assert.equal(ipBucket("::1"), "0:0:0:0::/64");
	assert.equal(ipBucket("unknown"), "unknown");
	assert.equal(ipBucket("not:an:ip"), "not:an:ip");
});
