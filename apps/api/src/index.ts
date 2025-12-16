import Fastify from "fastify";
import { initDB, disconnectDB } from "@repo/db";
import {
	registerCors,
	registerSwagger,
	registerTRPC,
	registerWS,
	registerRedis,
	registerRateLimit,
	registerMultipart,
	registerSSE,
} from "./plugins";
import {
	validatorCompiler,
	serializerCompiler,
} from "fastify-type-provider-zod";
import { registerRoutes } from "./routes/routes";
import { registerAuthRoutes } from "./routes/auth/auth.routes";
import { env } from "./config/env";
import { closeQueues, registerBullBoard } from "./jobs";

export const server = Fastify({
	// logger: {
	// 	level: env.NODE_ENV === "production" ? "info" : "debug",
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
		await registerSSE(server);
		await registerMultipart(server);
		await registerWS(server);
		await registerTRPC(server);
		await registerSwagger(server);
		await registerAuthRoutes(server);
		await registerBullBoard(server);

		// Register routes
		await registerRoutes(server);

		// Start server
		const port = env.PORT || 33450;
		const host = env.HOST || "127.0.0.1";

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

		console.log("🔌 Closing BullMQ queues...");
		await closeQueues();

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
