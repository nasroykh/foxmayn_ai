import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { initDB, disconnectDB } from "@repo/db";
import { env } from "./config/env";
import { describeError } from "./config/redact";
import { redis } from "./config/redis";
import { closeQueues } from "./jobs";
import { registerPlugins } from "./plugins/index";
import { registerHealth } from "./plugins/health";
import { initSuperAdmin } from "./plugins/auth";
import { initModelPricing } from "./services/model-pricing.service";

// Compose/Kubernetes should give the container at least this long to stop
const SHUTDOWN_TIMEOUT_MS = 25_000;

const app = new Hono().basePath(env.API_V1_PREFIX);

// Health endpoints must be registered before plugins so they are always reachable
registerHealth(app);

// One stray rejection (e.g. a failed background send) must not kill the API
process.on("unhandledRejection", (reason) => {
	console.error("[unhandledRejection]", describeError(reason));
});

let server: ServerType | undefined;
let shuttingDown = false;

const shutdown = async (signal: string) => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`Received ${signal}, shutting down...`);

	const forceExit = setTimeout(() => {
		console.error(
			`Shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`,
		);
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	forceExit.unref();

	// Stop accepting connections and let in-flight requests (streams) finish
	if (server) {
		await new Promise<void>((resolve) => {
			server!.close(() => resolve());
			if ("closeIdleConnections" in server!) server.closeIdleConnections();
		});
	}

	const results = await Promise.allSettled([
		closeQueues(),
		redis.quit(),
		disconnectDB(),
	]);
	for (const result of results) {
		if (result.status === "rejected") {
			console.error("Error during shutdown:", describeError(result.reason));
		}
	}

	process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");
		await initDB();

		// Initialize model pricing cache (seeds from static data, hydrates from Redis,
		// then fires a non-blocking refresh from OpenRouter API)
		await initModelPricing(redis);

		await initSuperAdmin();

		registerPlugins(app);

		server = serve(
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
		console.error("❌ Error during server startup:", describeError(error));
		process.exit(1);
	}
};

start();
