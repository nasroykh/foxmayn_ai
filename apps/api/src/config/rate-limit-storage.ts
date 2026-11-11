import type { BetterAuthOptions } from "better-auth";

type RateLimitStorage = NonNullable<
	NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

/** The slice of an ioredis client the storage needs (kept small for tests). */
export type RateLimitRedis = {
	incr(key: string): Promise<number>;
	expire(key: string, seconds: number): Promise<unknown>;
	ttl(key: string): Promise<number>;
};

const KEY_PREFIX = "auth:rl:";

/**
 * One fixed-window hit: INCR, set the TTL on the first hit. `retryAfter` is
 * the seconds left in the window (what the caller waits when blocked).
 * Throws when Redis fails; each caller picks fail open or closed.
 */
export const consumeFixedWindow = async (
	redis: RateLimitRedis,
	key: string,
	rule: { window: number; max: number },
): Promise<{ allowed: boolean; retryAfter: number }> => {
	const count = await redis.incr(key);
	let ttl = rule.window;
	if (count === 1) {
		await redis.expire(key, rule.window);
	} else {
		ttl = await redis.ttl(key);
		if (ttl < 0) {
			// Key without expiry (crash between INCR and EXPIRE): repair it
			await redis.expire(key, rule.window);
			ttl = rule.window;
		}
	}
	return { allowed: count <= rule.max, retryAfter: ttl };
};

/**
 * better-auth rate limit storage backed by Redis, so limits are shared across
 * API instances and survive restarts. Fixed window: INCR, set the TTL on the
 * first hit. Fails open (allows the request) when Redis is unavailable so an
 * outage does not lock everyone out of sign-in.
 */
export const createRedisRateLimitStorage = (
	redis: RateLimitRedis,
): RateLimitStorage => ({
	consume: async (key, rule) => {
		try {
			const result = await consumeFixedWindow(
				redis,
				`${KEY_PREFIX}${key}`,
				rule,
			);
			if (result.allowed) return { allowed: true, retryAfter: null };
			return { allowed: false, retryAfter: result.retryAfter };
		} catch (error) {
			console.error(
				"[auth] rate limit storage unavailable, allowing request:",
				error instanceof Error ? error.message : error,
			);
			return { allowed: true, retryAfter: null };
		}
	},
});
