import { isIP } from "node:net";
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

/**
 * Rate limit bucket of a client address. IPv4 stays as is, `::ffff:a.b.c.d`
 * counts as IPv4, IPv6 is grouped by /64 (one subscriber holds a whole /64, so
 * per-address buckets are free to dodge). Anything else stays as is.
 */
export const ipBucket = (ip: string): string => {
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
	if (mapped) return mapped[1]!;
	if (!ip.includes(":") || isIP(ip) !== 6) return ip;
	// Expand "::" to eight 16-bit groups and keep the first four
	const [head = "", tail] = ip.split("::");
	const headGroups = head ? head.split(":") : [];
	const tailGroups = tail ? tail.split(":") : [];
	const fill = ip.includes("::") ? 8 - headGroups.length - tailGroups.length : 0;
	const groups = [...headGroups, ...Array<string>(fill).fill("0"), ...tailGroups];
	const prefix = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
	return `${prefix.join(":")}::/64`;
};

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
			`${KEY_PREFIX}ip:${hostname}:${ipBucket(ip)}`,
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
