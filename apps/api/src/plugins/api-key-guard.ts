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

/**
 * Rejects better-auth's own API key endpoints. They accept `metadata` from the
 * browser, which would let a user rewrite the organization or knowledge base a
 * key is bound to. Keys are managed through the oRPC routes (apikey.service),
 * which set that metadata themselves.
 */
export const rejectRawApiKeyRoutes: MiddlewareHandler = async (c) =>
	c.json({ message: "Manage API keys through /api/v1/api-keys" }, 404);
