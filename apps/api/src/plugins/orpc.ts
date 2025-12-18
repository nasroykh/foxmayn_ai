import type { Hono } from "hono";
import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";

import { router } from "../router/index";

export const registerORPC = (app: Hono) => {
	const handler = new RPCHandler(router, {
		interceptors: [
			onError((error) => {
				console.error(error);
			}),
		],
	});

	app.use("/api/rpc/*", async (c, next) => {
		const { matched, response } = await handler.handle(c.req.raw, {
			prefix: "/api/rpc",
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
