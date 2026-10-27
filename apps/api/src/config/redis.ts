import Redis from "ioredis";
import { env } from "./env";

/**
 * Shared Redis client for the API process (model pricing cache, auth rate
 * limiting, readiness checks). BullMQ builds its own connections from
 * `jobs/connection.ts`.
 */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

redis.on("error", (error) => {
	console.error("[redis] connection error:", error.message);
});
