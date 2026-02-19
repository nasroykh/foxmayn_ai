import { Worker, Job } from "bullmq";
import { redisConnection } from "../connection";
import {
	type SendEmailJobData,
	type SendEmailJobResult,
	EmailJobNames,
} from "./types";
import { transporter } from "../../config/nodemailer";
import { env } from "../../config/env";

const QUEUE_NAME = "email";

/**
 * Process email sending job
 */
async function processSendEmail(
	job: Job<SendEmailJobData>
): Promise<SendEmailJobResult> {
	const { to, subject, html, text, template } = job.data;

	console.log(
		`[Email Worker] Sending email to: ${Array.isArray(to) ? to.join(", ") : to}`
	);

	let emailHtml = html;
	let emailText = text;

	// If using a template, render it
	if (template) {
		// You can implement template rendering here
		// For now, we'll just use the raw html/text
		console.log(`[Email Worker] Using template: ${template.name}`);
	}

	const result = await transporter.sendMail({
		from: env.SMTP_FROM,
		to: Array.isArray(to) ? to.join(", ") : to,
		subject,
		html: emailHtml,
		text: emailText,
	});

	console.log(`[Email Worker] Email sent successfully: ${result.messageId}`);

	return {
		messageId: result.messageId,
		accepted: result.accepted as string[],
		rejected: result.rejected as string[],
	};
}

/**
 * Main job processor
 */
async function processJob(job: Job<SendEmailJobData>) {
	switch (job.name) {
		case EmailJobNames.SEND:
			return processSendEmail(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
}

/**
 * Create and start the email worker
 */
export function createEmailWorker() {
	const worker = new Worker(QUEUE_NAME, processJob, {
		connection: redisConnection,
		// Higher concurrency for emails - they're mostly I/O bound
		concurrency: 10,
		// Shorter lock duration for emails
		lockDuration: 1000 * 60 * 2, // 2 minutes
	});

	worker.on("completed", (job, result) => {
		console.log(`[Email Worker] Job ${job.id} completed: ${result.messageId}`);
	});

	worker.on("failed", (job, err) => {
		console.error(
			`[Email Worker] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
			err.message
		);
	});

	worker.on("error", (err) => {
		console.error("[Email Worker] Worker error:", err);
	});

	console.log("[Email Worker] Worker started");

	return worker;
}
