import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";
import { logRpcError } from "./error-log";
import { isPublicSitePath } from "./public-site-path";

import { router } from "../router/index";
import { env } from "../config/env";

const rpcEndpoint = `${env.API_V1_PREFIX}/rpc` as `/${string}`;

export const registerORPC = (app: Hono) => {
	const handler = new RPCHandler(router, {
		interceptors: [
			onError(logRpcError),
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
			if (isPublicSitePath(c.req.path)) {
				const headers = new Headers(response.headers);
				headers.set("X-Robots-Tag", "noindex");
				return c.newResponse(response.body, {
					status: response.status as ContentfulStatusCode,
					headers,
				});
			}
			return c.newResponse(response.body, response);
		}

		return await next();
	});
};
