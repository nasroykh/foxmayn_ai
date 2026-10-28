/**
 * Mask an email address for logs: keeps the first character of the local part
 * and the domain, e.g. "jane.doe@example.com" -> "j***@example.com".
 */
export const maskEmail = (email: string | null | undefined): string => {
	if (!email) return "<none>";
	const at = email.lastIndexOf("@");
	if (at < 1) return "***";
	return `${email[0]}***${email.slice(at)}`;
};

export const maskEmails = (to: string | string[]): string =>
	(Array.isArray(to) ? to : [to]).map(maskEmail).join(", ");

const SECRET_PATTERNS: [RegExp, string][] = [
	[/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]"],
	[/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
];

/** Strip bearer tokens and API-key-looking strings from a log message. */
export const redactSecrets = (text: string): string =>
	SECRET_PATTERNS.reduce((out, [re, to]) => out.replace(re, to), text);

/** HTTP status carried by an SDK/provider error (or its cause), if any. */
export const errorStatus = (error: unknown, depth = 0): number | undefined => {
	if (!error || typeof error !== "object" || depth > 3) return undefined;
	const e = error as { statusCode?: unknown; status?: unknown; cause?: unknown };
	for (const v of [e.statusCode, e.status]) {
		if (typeof v === "number" && v >= 100 && v < 600) return v;
	}
	return errorStatus(e.cause, depth + 1);
};

/**
 * One-line, secret-free summary of an error for logs. Never log the raw error:
 * provider SDK errors carry the request (with its Authorization header).
 */
export const describeError = (error: unknown): string => {
	const name =
		error instanceof Error ? error.name || "Error" : typeof error;
	const status = errorStatus(error);
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "non-error value thrown";
	const summary = `${name}${status ? ` (status ${status})` : ""}: ${message}`;
	const safe = redactSecrets(summary);
	return safe.length > 500 ? `${safe.slice(0, 500)}...` : safe;
};

/**
 * Error name and HTTP status only. For calls whose request carries tool
 * arguments or results (PII): a provider or validation message may echo them.
 */
export const describeErrorBrief = (error: unknown): string => {
	const name = error instanceof Error ? error.name || "Error" : typeof error;
	const status = errorStatus(error);
	return `${name}${status ? ` (status ${status})` : ""}`;
};
