import { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./auth/auth.routes";
import { registerHealthRoutes } from "./health/health.route";
import { registerChatRoutes } from "./rag/chat.routes";
import { registerDocumentRoutes } from "./rag/documents.routes";

const PREFIX = "/api";

// Merged route registration function
export const registerRoutes = async (server: FastifyInstance) => {
	await server.register(
		(subServer) => {
			registerHealthRoutes(subServer);
			registerAuthRoutes(subServer);
			registerChatRoutes(subServer);
			registerDocumentRoutes(subServer);
		},
		{ prefix: PREFIX }
	);
};
