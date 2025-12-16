import { FastifyInstance } from "fastify";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";

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
 * Register Bull Board dashboard with Fastify
 * Access at: /admin/queues
 */
export async function registerBullBoard(server: FastifyInstance) {
	const serverAdapter = new FastifyAdapter();
	serverAdapter.setBasePath("/admin/queues");

	createBullBoard({
		queues: [new BullMQAdapter(documentQueue), new BullMQAdapter(emailQueue)],
		serverAdapter,
	});

	// Register the Bull Board routes
	await server.register(serverAdapter.registerPlugin(), {
		prefix: "/admin/queues",
	});

	console.log("📊 Bull Board dashboard available at /admin/queues");
}

/**
 * Gracefully close all queues
 * Call this during server shutdown
 */
export async function closeQueues() {
	await Promise.all([documentQueue.close(), emailQueue.close()]);
	console.log("🔌 All queues closed");
}
