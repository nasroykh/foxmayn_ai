import { FastifyInstance } from "fastify";
import fastifySSE from "@fastify/sse";

export const registerSSE = async (server: FastifyInstance) => {
	await server.register(fastifySSE);
};
