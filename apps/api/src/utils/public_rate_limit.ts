import { ORPCError } from "@orpc/server";
import {
	consumeFixedWindow,
	type RateLimitRedis,
} from "../config/rate-limit-storage";

/** Per client IP per hostname. */
export const PUBLIC_CHAT_IP_LIMIT = { window: 10 * 60, max: 20 } as const;
/** Per hostname, all visitors together. */
export const PUBLIC_CHAT_SITE_LIMIT = { window: 24 * 60 * 60, max: 500 } as const;

const KEY_PREFIX = "public:rl:";

const tooManyRequests = (retryAfterSeconds: number) =>
	new ORPCError("TOO_MANY_REQUESTS", {
		status: 429,
		message: "Too many requests. Please try again later.",
		// Same shape as the API key rate limit (router/errors.ts)
		data: { code: "RATE_LIMITED", retryAfterSeconds },
	});

/**
 * Rate limits of the public chat (fixed windows in Redis). The IP window is
 * counted first, so a blocked visitor does not use up the site's daily budget.
 * Throws 429 (with the wait) over a limit. Fails closed: when Redis errors the
 * chat is refused (503), because every answer spends credits.
 */
export const enforcePublicChatLimits = async (
	redis: RateLimitRedis,
	hostname: string,
	ip: string,
): Promise<void> => {
	try {
		const perIp = await consumeFixedWindow(
			redis,
			`${KEY_PREFIX}ip:${hostname}:${ip}`,
			PUBLIC_CHAT_IP_LIMIT,
		);
		if (!perIp.allowed) throw tooManyRequests(perIp.retryAfter);

		const perSite = await consumeFixedWindow(
			redis,
			`${KEY_PREFIX}site:${hostname}`,
			PUBLIC_CHAT_SITE_LIMIT,
		);
		if (!perSite.allowed) throw tooManyRequests(perSite.retryAfter);
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		console.error(
			"[public-chat] rate limit storage unavailable, refusing request:",
			error instanceof Error ? error.message : error,
		);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "The assistant is temporarily unavailable. Please try again later.",
		});
	}
};
