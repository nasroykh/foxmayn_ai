import { Queue, type JobsOptions } from "bullmq";
import { redisConnection, defaultJobOptions } from "../connection";
import { type SendEmailJobData, EmailJobNames } from "./types";

const QUEUE_NAME = "email";

/**
 * Email sending queue
 * Handles: transactional emails, notifications
 */
export const emailQueue = new Queue<SendEmailJobData>(QUEUE_NAME, {
	connection: redisConnection,
	defaultJobOptions: {
		...defaultJobOptions,
		// Emails should retry more aggressively
		attempts: 5,
		backoff: {
			type: "exponential",
			delay: 2000, // 2s, 4s, 8s, 16s, 32s
		},
	},
});

/**
 * Add an email sending job to the queue
 */
export async function addSendEmailJob(
	data: SendEmailJobData,
	options?: JobsOptions
) {
	const job = await emailQueue.add(EmailJobNames.SEND, data, {
		...options,
	});

	return {
		jobId: job.id,
	};
}

/**
 * Add a high-priority email (password reset, verification, etc.)
 */
export async function addPriorityEmailJob(
	data: SendEmailJobData,
	options?: JobsOptions
) {
	const job = await emailQueue.add(EmailJobNames.SEND, data, {
		...options,
		priority: 1, // Highest priority
	});

	return {
		jobId: job.id,
	};
}

/**
 * Schedule an email to be sent later
 */
export async function scheduleEmailJob(
	data: SendEmailJobData,
	delayMs: number,
	options?: JobsOptions
) {
	const job = await emailQueue.add(EmailJobNames.SEND, data, {
		...options,
		delay: delayMs,
	});

	return {
		jobId: job.id,
		scheduledFor: new Date(Date.now() + delayMs).toISOString(),
	};
}

/**
 * Get email queue stats
 */
export async function getEmailQueueStats() {
	const [waiting, active, completed, failed] = await Promise.all([
		emailQueue.getWaitingCount(),
		emailQueue.getActiveCount(),
		emailQueue.getCompletedCount(),
		emailQueue.getFailedCount(),
	]);

	return {
		waiting,
		active,
		completed,
		failed,
	};
}
