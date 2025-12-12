import cors from "@fastify/cors";
import { FastifyInstance } from "fastify";

export const registerCors = async (server: FastifyInstance) => {
	await server.register(cors, {
		origin: process.env.APP_URL || "http://localhost:33460",
		credentials: true,
	});
};
