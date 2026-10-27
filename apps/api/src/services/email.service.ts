import {
	addPriorityEmailJob,
	addSendEmailJob,
} from "../jobs/email/email.queue";
import { maskEmail } from "../config/redact";
import { withTimeout } from "../config/timeout";
import {
	OTP_EMAIL_HTML,
	INVITATION_EMAIL_HTML,
} from "../utils/email_templates";

// Do not let a Redis outage hang the auth request that triggered the email
const ENQUEUE_TIMEOUT_MS = 5000;

/**
 * Emails are sent by the email worker (BullMQ retries with backoff), never
 * inline, so an SMTP failure cannot reject inside a request or crash the API.
 * These functions only enqueue the job and throw if the enqueue itself fails.
 */

export const sendOTPEmail = async (to: string, otp: string) => {
	try {
		await withTimeout(
			addPriorityEmailJob({
				to,
				subject: "Your One-Time Password (OTP)",
				html: OTP_EMAIL_HTML(otp),
			}),
			ENQUEUE_TIMEOUT_MS,
			"OTP email enqueue",
		);
		console.log(`OTP email queued for ${maskEmail(to)}`);
	} catch (error) {
		console.error(
			`Error queueing OTP email for ${maskEmail(to)}:`,
			error instanceof Error ? error.message : error,
		);
		throw new Error("Failed to send OTP email");
	}
};

export const sendInvitationEmail = async (
	to: string,
	inviterName: string,
	organizationName: string,
	inviteLink: string,
) => {
	try {
		await withTimeout(
			addSendEmailJob({
				to,
				subject: `You've been invited to join ${organizationName}`,
				html: INVITATION_EMAIL_HTML(inviterName, organizationName, inviteLink),
			}),
			ENQUEUE_TIMEOUT_MS,
			"Invitation email enqueue",
		);
		console.log(`Invitation email queued for ${maskEmail(to)}`);
	} catch (error) {
		console.error(
			`Error queueing invitation email for ${maskEmail(to)}:`,
			error instanceof Error ? error.message : error,
		);
		throw new Error("Failed to send invitation email");
	}
};
