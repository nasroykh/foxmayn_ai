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
 * better-auth rate limit storage backed by Redis, so limits are shared across
 * API instances and survive restarts. Fixed window: INCR, set the TTL on the
 * first hit. Fails open (allows the request) when Redis is unavailable so an
 * outage does not lock everyone out of sign-in.
 */
export const createRedisRateLimitStorage = (
	redis: RateLimitRedis,
): RateLimitStorage => ({
	consume: async (key, rule) => {
		const redisKey = `${KEY_PREFIX}${key}`;
		try {
			const count = await redis.incr(redisKey);
			let ttl = rule.window;
			if (count === 1) {
				await redis.expire(redisKey, rule.window);
			} else {
				ttl = await redis.ttl(redisKey);
				if (ttl < 0) {
					// Key without expiry (crash between INCR and EXPIRE): repair it
					await redis.expire(redisKey, rule.window);
					ttl = rule.window;
				}
			}

			if (count <= rule.max) return { allowed: true, retryAfter: null };
			return { allowed: false, retryAfter: ttl };
		} catch (error) {
			console.error(
				"[auth] rate limit storage unavailable, allowing request:",
				error instanceof Error ? error.message : error,
			);
			return { allowed: true, retryAfter: null };
		}
	},
});
