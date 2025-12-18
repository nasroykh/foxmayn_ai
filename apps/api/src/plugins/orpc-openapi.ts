import type { Hono } from "hono";
import { onError } from "@orpc/server";

import { router } from "../router/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";

export const registerORPCOpenAPI = (app: Hono) => {
	const handler = new OpenAPIHandler(router, {
		interceptors: [
			onError((error) => {
				console.error(error);
			}),
		],
	});

	app.use("/api/*", async (c, next) => {
		const { matched, response } = await handler.handle(c.req.raw, {
			prefix: "/api",
			context: {
				headers: new Headers(c.req.header()),
			},
		});

		if (matched) {
			return c.newResponse(response.body, response);
		}

		return await next();
	});
};
