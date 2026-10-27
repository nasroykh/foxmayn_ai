import type { Hono } from "hono";
import { onError } from "@orpc/server";
import { logRpcError } from "./error-log";

import { router } from "../router/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";

export const registerORPCOpenAPI = (app: Hono) => {
	const handler = new OpenAPIHandler(router, {
		interceptors: [
			onError(logRpcError),
		],
	});

	app.use("/*", async (c, next) => {
		const { matched, response } = await handler.handle(c.req.raw, {
			context: {
				headers: new Headers(c.req.header()),
			},
		});

		if (matched) {
			// API key rate limit: expose the wait as a standard header too
			if (response.status === 429) {
				const body = (await response
					.clone()
					.json()
					.catch(() => null)) as { data?: { retryAfterSeconds?: unknown } } | null;
				const retryAfter = body?.data?.retryAfterSeconds;
				if (typeof retryAfter === "number") {
					const headers = new Headers(response.headers);
					headers.set("Retry-After", String(retryAfter));
					return c.newResponse(response.body, { status: 429, headers });
				}
			}
			return c.newResponse(response.body, response);
		}

		return await next();
	});
};
