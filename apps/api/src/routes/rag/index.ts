import { FastifyInstance } from "fastify";
import { registerDocumentRoutes } from "./documents.routes";
import { registerChatRoutes } from "./chat.routes";

export const registerRAGRoutes = async (server: FastifyInstance) => {
	await registerDocumentRoutes(server);
	await registerChatRoutes(server);
};

