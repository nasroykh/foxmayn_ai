import type { Hono } from "hono";
import { onError } from "@orpc/server";

import { router } from "../router/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";

export const registerORPCOpenAPI = (app: Hono) => {
	const handler = new OpenAPIHandler(router, {
		interceptors: [
			onError((error) => {
				console.log(error);
			}),
		],
	});

	app.use("/*", async (c, next) => {
		const { matched, response } = await handler.handle(c.req.raw, {
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
