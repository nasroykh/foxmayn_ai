import { Hono } from "hono";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";

import { documentQueue, emailQueue } from "../jobs";
import { env } from "../config/env";

const bullBoardEndpoint = `/admin/queues`;

/**
 * Register Bull Board dashboard with Hono
 * Access at: /api/v1/admin/queues
 */
export const registerBullBoard = (app: Hono) => {
	const serverAdapter = new HonoAdapter(serveStatic);
	serverAdapter.setBasePath(`${env.API_V1_PREFIX}${bullBoardEndpoint}`);

	createBullBoard({
		queues: [new BullMQAdapter(documentQueue), new BullMQAdapter(emailQueue)],
		serverAdapter,
	});

	// Register the Bull Board routes
	app.route(bullBoardEndpoint, serverAdapter.registerPlugin());
};
