import cors from "@fastify/cors";
import { FastifyInstance } from "fastify";
import { env } from "../config/env";

export const registerCors = async (server: FastifyInstance) => {
	await server.register(cors, {
		origin: env.APP_URL || "http://localhost:33460",
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Accept", "Authorization"],
	});
};
