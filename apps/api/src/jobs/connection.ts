import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env";

/**
 * BullMQ Redis connection options
 *
 * IMPORTANT: maxRetriesPerRequest must be null for BullMQ workers
 * to handle Redis reconnection properly without throwing errors
 */
export const redisConnection: ConnectionOptions = {
	host: new URL(env.REDIS_URL).hostname,
	port: parseInt(new URL(env.REDIS_URL).port || "6379"),
	password: new URL(env.REDIS_URL).password || undefined,
	// Critical for BullMQ - prevents connection errors from breaking workers
	maxRetriesPerRequest: null,
	// Enable ready check for connection validation
	enableReadyCheck: true,
	// Reconnection strategy with exponential backoff
	retryStrategy: (times: number) => {
		const delay = Math.min(times * 50, 2000);
		return delay;
	},
};

/**
 * Default job options applied to all queues
 */
export const defaultJobOptions = {
	attempts: 3,
	backoff: {
		type: "exponential" as const,
		delay: 1000, // Start with 1s, then 2s, 4s
	},
	removeOnComplete: {
		age: 24 * 3600, // Keep completed jobs for 24 hours
		count: 1000, // Keep last 1000 completed jobs
	},
	removeOnFail: {
		age: 7 * 24 * 3600, // Keep failed jobs for 7 days
	},
};
