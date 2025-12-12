import { FastifyInstance } from "fastify";
import redis from "@fastify/redis";

export const registerRedis = async (server: FastifyInstance) => {
	await server.register(redis, {
		url: process.env.REDIS_URL || "redis://localhost:6379",
		closeClient: true,
	});
};
