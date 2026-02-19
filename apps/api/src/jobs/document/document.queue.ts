import { Queue, type JobsOptions } from "bullmq";
import { redisConnection, defaultJobOptions } from "../connection";
import {
	type IndexDocumentJobData,
	type DeleteDocumentJobData,
	type ReindexDocumentJobData,
	DocumentJobNames,
} from "./types";

const QUEUE_NAME = "document";

/**
 * Document processing queue
 * Handles: indexing, deletion, re-indexing
 */
export const documentQueue = new Queue<
	IndexDocumentJobData | DeleteDocumentJobData | ReindexDocumentJobData
>(QUEUE_NAME, {
	connection: redisConnection,
	defaultJobOptions,
});

/**
 * Add a document indexing job to the queue
 * Returns immediately with jobId - processing happens in background
 */
export async function addIndexDocumentJob(
	data: IndexDocumentJobData,
	options?: JobsOptions
) {
	const job = await documentQueue.add(DocumentJobNames.INDEX, data, {
		...options,
		// Use documentId as jobId for idempotency
		jobId: `index-${data.documentId}`,
	});

	return {
		jobId: job.id,
		documentId: data.documentId,
	};
}

/**
 * Add a document deletion job to the queue
 */
export async function addDeleteDocumentJob(
	data: DeleteDocumentJobData,
	options?: JobsOptions
) {
	const job = await documentQueue.add(DocumentJobNames.DELETE, data, {
		...options,
		jobId: `delete-${data.documentId}`,
		// Deletion should be higher priority
		priority: 1,
	});

	return {
		jobId: job.id,
		documentId: data.documentId,
	};
}

/**
 * Add a re-indexing job (delete + re-index)
 */
export async function addReindexDocumentJob(
	data: ReindexDocumentJobData,
	options?: JobsOptions
) {
	const job = await documentQueue.add(DocumentJobNames.REINDEX, data, {
		...options,
		jobId: `reindex-${data.documentId}`,
	});

	return {
		jobId: job.id,
		documentId: data.documentId,
	};
}

/**
 * Get job status by ID
 */
export async function getDocumentJobStatus(jobId: string) {
	const job = await documentQueue.getJob(jobId);

	if (!job) {
		return null;
	}

	const state = await job.getState();
	const progress = job.progress;

	return {
		jobId: job.id,
		name: job.name,
		state,
		progress,
		data: job.data,
		returnvalue: job.returnvalue,
		failedReason: job.failedReason,
		attemptsMade: job.attemptsMade,
		timestamp: job.timestamp,
		finishedOn: job.finishedOn,
		processedOn: job.processedOn,
	};
}

/**
 * Get all pending/active document jobs
 */
export async function getPendingDocumentJobs() {
	const [waiting, active, delayed] = await Promise.all([
		documentQueue.getJobs(["waiting"]),
		documentQueue.getJobs(["active"]),
		documentQueue.getJobs(["delayed"]),
	]);

	return {
		waiting: waiting.length,
		active: active.length,
		delayed: delayed.length,
		jobs: [...waiting, ...active, ...delayed].map((job) => ({
			jobId: job.id,
			name: job.name,
			documentId: (job.data as IndexDocumentJobData).documentId,
			progress: job.progress,
		})),
	};
}
