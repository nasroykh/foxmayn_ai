import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDB } from "@repo/db";
import { env } from "./config/env";
import { registerPlugins } from "./plugins/index";

const app = new Hono().basePath(env.API_V1_PREFIX);

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");
		await initDB();

		registerPlugins(app);

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
