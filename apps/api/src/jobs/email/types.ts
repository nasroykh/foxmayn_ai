/**
 * Job payload types for type-safe queue operations
 */

// ============================================================================
// Email Jobs
// ============================================================================

export interface SendEmailJobData {
	to: string | string[];
	subject: string;
	html?: string;
	text?: string;
	template?: {
		name: string;
		data: Record<string, unknown>;
	};
}

// ============================================================================
// Job Results
// ============================================================================

export interface SendEmailJobResult {
	messageId: string;
	accepted: string[];
	rejected: string[];
}

// ============================================================================
// Job Names (for type-safe job.name checks)
// ============================================================================

export const EmailJobNames = {
	SEND: "email:send",
	SEND_BATCH: "email:send-batch",
} as const;

export type EmailJobName = (typeof EmailJobNames)[keyof typeof EmailJobNames];
