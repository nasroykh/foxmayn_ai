import type { Hono } from "hono";
import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";

import { router } from "../router/index";
import { env } from "../config/env";

const rpcEndpoint = `${env.API_V1_PREFIX}/rpc` as `/${string}`;

export const registerORPC = (app: Hono) => {
	const handler = new RPCHandler(router, {
		interceptors: [
			onError((error) => {
				console.error(error);
			}),
		],
	});

	app.use(`/rpc/*`, async (c, next) => {
		const { matched, response } = await handler.handle(c.req.raw, {
			prefix: rpcEndpoint,
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
