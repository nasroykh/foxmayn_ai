// Export queues
export {
	documentQueue,
	addIndexDocumentJob,
	addDeleteDocumentJob,
	addReindexDocumentJob,
	getDocumentJobStatus,
	getPendingDocumentJobs,
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

/**
 * Gracefully close all queues
 * Call this during server shutdown
 */
export async function closeQueues() {
	await Promise.all([documentQueue.close(), emailQueue.close()]);
	console.log("🔌 All queues closed");
}
