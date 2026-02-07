import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDB, disconnectDB } from "@repo/db";
import { env } from "./config/env";
import { registerPlugins } from "./plugins/index";

const app = new Hono().basePath(env.API_V1_PREFIX);

// Health check endpoint (outside basePath for easy access)
const rootApp = new Hono();
rootApp.get("/health", (c) =>
	c.json({ status: "ok", timestamp: new Date().toISOString() })
);
rootApp.route("/", app);

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");
		await initDB();

		registerPlugins(app);

		const server = serve(
			{
				fetch: rootApp.fetch,
				port: env.PORT,
				hostname: env.HOST,
			},
			(info) => {
				console.log(`Server is running on http://${info.address}:${info.port}`);
			}
		);

		// Graceful shutdown
		const shutdown = async (signal: string) => {
			console.log(`\n${signal} received. Shutting down gracefully...`);
			server.close();
			await disconnectDB();
			process.exit(0);
		};

		process.on("SIGTERM", () => shutdown("SIGTERM"));
		process.on("SIGINT", () => shutdown("SIGINT"));
	} catch (error) {
		console.error("❌ Error during server startup:", error);
		process.exit(1);
	}
};

start();
