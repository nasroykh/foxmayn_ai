// Export queues
export {
	documentQueue,
	addIndexDocumentJob,
	addTranscribeDocumentJob,
	addDeleteDocumentJob,
	addReindexDocumentJob,
	getDocumentJobStatus,
	getPendingDocumentJobs,
} from "./document/document.queue";
export type {
	DocumentJobStatus,
	PendingDocumentJob,
} from "./document/document.queue";
export {
	emailQueue,
	addSendEmailJob,
	addPriorityEmailJob,
	scheduleEmailJob,
	getEmailQueueStats,
} from "./email/email.queue";

// Export workers
export { createDocumentWorker } from "./document/document.worker";
export { createEmailWorker } from "./email/email.worker";

// Export types
export * from "./document/types";
export * from "./email/types";

// Import queues for Bull Board
import { documentQueue } from "./document/document.queue";
import { emailQueue } from "./email/email.queue";
import { initModelCatalog } from "../services/model-catalog.service";
import { redis } from "../config/redis";
import { describeError } from "../config/redact";

/**
 * Gracefully close all queues
 * Call this during server shutdown
 */
export async function closeQueues() {
	await Promise.all([documentQueue.close(), emailQueue.close()]);
	console.log("🔌 All queues closed");
}

/**
 * Load the chat model catalog (Redis copy, else the static list, then a daily
 * refresh) into this process. The API does it at start; the worker prices
 * billed model calls (page transcription) from the same catalog, so it must too.
 * Never throws: a failure leaves the static list in use, like in the API.
 */
export async function initWorkerModelCatalog() {
	try {
		await initModelCatalog(redis);
	} catch (error) {
		console.error(
			"[Models] Catalog init failed, using the static list:",
			describeError(error),
		);
	}
}
