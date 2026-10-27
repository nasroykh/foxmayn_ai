import { Hono } from "hono";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";

import { documentQueue, emailQueue } from "../jobs";
import { env } from "../config/env";
import { auth } from "../config/auth";
import { hasAdminRole } from "../router/middleware";

const bullBoardEndpoint = `/admin/queues`;

/**
 * Register Bull Board dashboard with Hono (admin session required)
 * Access at: /api/v1/admin/queues
 */
export const registerBullBoard = (app: Hono) => {
	// Same admin check as the oRPC `adminProcedure`, on the session cookie
	app.use(`${bullBoardEndpoint}/*`, async (c, next) => {
		const sessionData = await auth.api.getSession({
			headers: c.req.raw.headers,
		});

		if (!sessionData?.session || !sessionData?.user) {
			return c.json({ message: "Session expired or invalid" }, 401);
		}
		if (!hasAdminRole(sessionData.user.role)) {
			return c.json({ message: "Admin access required" }, 403);
		}

		return next();
	});

	const serverAdapter = new HonoAdapter(serveStatic);
	serverAdapter.setBasePath(`${env.API_V1_PREFIX}${bullBoardEndpoint}`);

	createBullBoard({
		queues: [new BullMQAdapter(documentQueue), new BullMQAdapter(emailQueue)],
		serverAdapter,
	});

	// Register the Bull Board routes
	app.route(bullBoardEndpoint, serverAdapter.registerPlugin());
};
