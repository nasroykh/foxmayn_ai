import { config as dotenvConfig } from "dotenv";
import Fastify from "fastify";
import { initDB, disconnectDB } from "@repo/db";
import {
	registerCors,
	registerSwagger,
	// registerTRPC,
	registerWS,
	registerRedis,
	registerRateLimit,
	registerMultipart,
} from "./plugins";
import {
	validatorCompiler,
	serializerCompiler,
} from "fastify-type-provider-zod";
import { registerRoutes } from "./routes/routes";
import { registerAuthRoutes } from "./routes/auth/auth.routes";

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

server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);

const start = async () => {
	try {
		console.log("🚀 Starting server initialization...");

		// Initialize external connections in parallel (DB + Redis are independent)
		await Promise.all([initDB(), registerRedis(server)]);

		// Register plugins (order matters for some)
		await registerCors(server);
		await registerRateLimit(server);
		await registerMultipart(server);
		await registerWS(server);
		// await registerTRPC(server);
		await registerSwagger(server);
		await registerAuthRoutes(server);

		// Register routes
		await registerRoutes(server);

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
