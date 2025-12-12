import { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./auth/auth.routes";
import { registerHealthRoutes } from "./health/health.route";
import { registerRAGRoutes } from "./rag";

const PREFIX = "/api";

export const registerRoutes = async (server: FastifyInstance) => {
	await server.register(registerHealthRoutes, { prefix: PREFIX });
	await server.register(registerAuthRoutes, { prefix: PREFIX });
	await server.register(registerRAGRoutes, { prefix: PREFIX });
};
