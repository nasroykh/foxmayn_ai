import { FastifyInstance } from "fastify";
import redis from "@fastify/redis";
import { env } from "../config/env";

export const registerRedis = async (server: FastifyInstance) => {
	await server.register(redis, {
		url: env.REDIS_URL || "redis://localhost:6379",
		closeClient: true,
	});
};
