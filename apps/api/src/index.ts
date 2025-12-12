import { config as dotenvConfig } from "dotenv";
import Fastify from "fastify";
import { initDB, disconnectDB } from "@repo/db";
import {
	registerCors,
	registerSwagger,
	registerTRPC,
	registerWS,
	registerRedis,
	registerAuth,
	registerRateLimit,
} from "./plugins";

dotenvConfig({ override: true, quiet: true });

export const server = Fastify({
	// logger: {
	// 	level: process.env.NODE_ENV === "production" ? "info" : "debug",
	// },
	// Increase URL parameter length to handle long tRPC batch requests
	routerOptions: {
		maxParamLength: 5000,
	},
});

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");

		// Initialize database
		await initDB();

		// Register plugins
		await registerCors(server);
		await registerRateLimit(server);
		await registerTRPC(server);
		await registerSwagger(server);
		await registerWS(server);
		await registerRedis(server);
		await registerAuth(server);

		// Start server
		const port = parseInt(process.env.PORT || "33450");
		const host = process.env.HOST || "0.0.0.0";

		await server.listen({ port, host });

		console.log(`🚀 Server running at http://${host}:${port}`);
		console.log(`📖 Swagger docs available at http://${host}:${port}/docs`);
	} catch (error) {
		console.error("❌ Error during server startup:", error);
		process.exit(1);
	}
};

// Graceful shutdown
async function gracefulShutdown() {
	console.log("\n🛑 Shutting down gracefully...");

	try {
		console.log("🔌 Closing Fastify server...");
		await server.close();

		console.log("🔌 Disconnecting from database...");
		await disconnectDB();

		console.log("🔌 Closing Redis connection...");
		if (server.redis) {
			await server.redis.quit();
		}

		console.log("✅ Shutdown complete");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error during shutdown:", error);
		process.exit(1);
	}
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

start();
