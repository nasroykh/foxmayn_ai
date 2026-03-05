import { serve } from "@hono/node-server";
import { Hono } from "hono";
import Redis from "ioredis";
import { initDB } from "@repo/db";
import { env } from "./config/env";
import { registerPlugins } from "./plugins/index";
import { initModelPricing } from "./services/model-pricing.service";

const app = new Hono().basePath(env.API_V1_PREFIX);

// Plain HTTP health endpoint for Docker healthchecks — must be
// registered before plugins so it is always reachable.
app.get("/health", (c) =>
	c.json({
		status: "healthy",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		environment: process.env.NODE_ENV ?? "development",
	}),
);

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");
		await initDB();

		// Initialize model pricing cache (seeds from static data, hydrates from Redis,
		// then fires a non-blocking refresh from OpenRouter API)
		const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
		await initModelPricing(redis);

		registerPlugins(app);

		serve(
			{
				fetch: app.fetch,
				port: env.PORT,
				hostname: env.HOST,
			},
			(info) => {
				console.log(`Server is running on http://${info.address}:${info.port}`);
			},
		);
	} catch (error) {
		console.error("❌ Error during server startup:", error);
		process.exit(1);
	}
};

start();
