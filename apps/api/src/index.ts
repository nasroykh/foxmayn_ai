import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDB } from "@repo/db";
import { env } from "./config/env";
import { auth } from "./config/auth";
import {
	registerCors,
	registerORPC,
	registerORPCOpenAPI,
} from "./plugins/index";

const app = new Hono();

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");
		await initDB();

		registerCors(app);
		registerORPC(app);
		registerORPCOpenAPI(app);

		app.on(["POST", "GET"], "/api/auth/*", (c) => {
			return auth.handler(c.req.raw);
		});

		serve(
			{
				fetch: app.fetch,
				port: env.PORT,
				hostname: env.HOST,
			},
			(info) => {
				console.log(`Server is running on http://${info.address}:${info.port}`);
			}
		);
	} catch (error) {
		console.error("❌ Error during server startup:", error);
		process.exit(1);
	}
};

start();
