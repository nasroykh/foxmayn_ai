// Provider SDK errors carry the full request (including the Authorization
// header). Never log them raw: log this summary instead.

const SECRET_PATTERNS: [RegExp, string][] = [
	[/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]"],
	[/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
];

const redactSecrets = (text: string): string =>
	SECRET_PATTERNS.reduce((out, [re, to]) => out.replace(re, to), text);

const errorStatus = (error: unknown, depth = 0): number | undefined => {
	if (!error || typeof error !== "object" || depth > 3) return undefined;
	const e = error as { statusCode?: unknown; status?: unknown; cause?: unknown };
	for (const v of [e.statusCode, e.status]) {
		if (typeof v === "number" && v >= 100 && v < 600) return v;
	}
	return errorStatus(e.cause, depth + 1);
};

/** One-line, secret-free summary: name, HTTP status, redacted message. */
export const describeError = (error: unknown): string => {
	const name = error instanceof Error ? error.name || "Error" : typeof error;
	const status = errorStatus(error);
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "non-error value thrown";
	const safe = redactSecrets(
		`${name}${status ? ` (status ${status})` : ""}: ${message}`,
	);
	return safe.length > 500 ? `${safe.slice(0, 500)}...` : safe;
};
