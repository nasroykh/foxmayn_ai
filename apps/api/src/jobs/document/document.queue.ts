import { randomUUID } from "node:crypto";
import { Queue, type JobsOptions, type JobType } from "bullmq";
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
	options?: JobsOptions,
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
	options?: JobsOptions,
) {
	const job = await documentQueue.add(DocumentJobNames.DELETE, data, {
		...options,
		// Unique per call: a fixed id would be deduplicated against a failed delete
		// job (kept for 7 days) and silently do nothing
		jobId: `delete-${data.documentId}-${randomUUID()}`,
		// Deletion should be higher priority
		priority: 1,
	});

	return {
		jobId: job.id,
		documentId: data.documentId,
	};
}

/**
 * Add a re-indexing job (delete vectors + chunks, then index again).
 * The job id is unique per call: a fixed id would be deduplicated against a
 * finished job for 24h and silently do nothing.
 */
export async function addReindexDocumentJob(
	data: ReindexDocumentJobData,
	options?: JobsOptions,
) {
	const job = await documentQueue.add(DocumentJobNames.REINDEX, data, {
		...options,
		jobId: `reindex-${data.documentId}-${randomUUID()}`,
	});

	return {
		jobId: job.id,
		documentId: data.documentId,
	};
}

export interface DocumentJobStatus {
	jobId: string;
	name: string;
	state: string;
	progress: number;
	returnvalue: unknown;
	failedReason: string | undefined;
	attemptsMade: number;
	processedOn: number | undefined;
	finishedOn: number | undefined;
}

const toProgress = (progress: unknown): number =>
	typeof progress === "number" ? progress : 0;

/**
 * Get job status by ID. Returns null when the job does not exist or belongs
 * to another user, so job ids of other tenants cannot be probed.
 */
export async function getDocumentJobStatus(
	jobId: string,
	userId: string,
): Promise<DocumentJobStatus | null> {
	const job = await documentQueue.getJob(jobId);

	if (!job || job.data.userId !== userId) {
		return null;
	}

	return {
		jobId: job.id ?? jobId,
		name: job.name,
		state: await job.getState(),
		progress: toProgress(job.progress),
		returnvalue: job.returnvalue,
		failedReason: job.failedReason,
		attemptsMade: job.attemptsMade,
		processedOn: job.processedOn,
		finishedOn: job.finishedOn,
	};
}

export interface PendingDocumentJob {
	jobId: string;
	name: string;
	documentId: string;
	state: "active" | "waiting" | "prioritized" | "delayed";
	progress: number;
}

const PENDING_STATES = ["active", "waiting", "prioritized", "delayed"] as const;
const SCAN_PAGE_SIZE = 100;
// Upper bound on jobs read per request, whatever the queue length
const MAX_SCANNED_JOBS = 1000;

/**
 * The caller's pending/active document jobs, paginated.
 * Jobs are read from the queue in small pages and filtered by owner, so
 * other tenants' jobs are never returned (and job data stays small: no content).
 */
export async function getPendingDocumentJobs(
	userId: string,
	options: { limit: number; offset: number },
): Promise<{ jobs: PendingDocumentJob[]; hasMore: boolean }> {
	const { limit, offset } = options;
	const jobs: PendingDocumentJob[] = [];
	let skipped = 0;
	let scanned = 0;
	let hasMore = false;

	scan: for (const state of PENDING_STATES) {
		for (let start = 0; scanned < MAX_SCANNED_JOBS; start += SCAN_PAGE_SIZE) {
			const page = await documentQueue.getJobs(
				[state satisfies JobType],
				start,
				start + SCAN_PAGE_SIZE - 1,
			);
			scanned += page.length;

			for (const job of page) {
				if (job.data.userId !== userId) continue;
				if (skipped < offset) {
					skipped++;
					continue;
				}
				if (jobs.length >= limit) {
					hasMore = true;
					break scan;
				}
				jobs.push({
					jobId: job.id ?? "",
					name: job.name,
					documentId: job.data.documentId,
					state,
					progress: toProgress(job.progress),
				});
			}

			if (page.length < SCAN_PAGE_SIZE) break;
		}
	}

	return { jobs, hasMore };
}
