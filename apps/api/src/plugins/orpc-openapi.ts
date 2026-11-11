import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { onError } from "@orpc/server";
import { logRpcError } from "./error-log";
import { isPublicSitePath } from "./public-site-path";

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
			const headers = new Headers(response.headers);

			// API key rate limit: expose the wait as a standard header too
			if (response.status === 429) {
				const body = (await response
					.clone()
					.json()
					.catch(() => null)) as { data?: { retryAfterSeconds?: unknown } } | null;
				const retryAfter = body?.data?.retryAfterSeconds;
				if (typeof retryAfter === "number") {
					headers.set("Retry-After", String(retryAfter));
				}
			}
			// Public site routes: keep them out of search engines
			if (isPublicSitePath(c.req.path)) headers.set("X-Robots-Tag", "noindex");

			return c.newResponse(response.body, {
				status: response.status as ContentfulStatusCode,
				headers,
			});
		}

		return await next();
	});
};
