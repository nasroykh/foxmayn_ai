import type { MiddlewareHandler } from "hono";

import { API_KEY_HEADER } from "../config/constants";

/**
 * Rejects requests that carry an API key header.
 *
 * With enableSessionForAPIKeys, better-auth turns the key into a session on
 * every endpoint, so a leaked key could mint new keys or change organization
 * membership through the raw /auth routes. API keys are only meant for the
 * oRPC routes, which resolve the session in-process and are not affected by
 * this guard.
 */
export const rejectApiKeyHeader: MiddlewareHandler = async (c, next) => {
	if (c.req.raw.headers.has(API_KEY_HEADER)) {
		return c.json(
			{ message: "API keys cannot be used on authentication endpoints" },
			403,
		);
	}
	return next();
};
