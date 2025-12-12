import { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

export const registerRateLimit = async (server: FastifyInstance) => {
	await server.register(rateLimit, {
		max: 100,
		timeWindow: "1 minute",
	});
};
