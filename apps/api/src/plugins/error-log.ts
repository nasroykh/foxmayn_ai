import { ORPCError } from "@orpc/server";
import { describeError, redactSecrets } from "../config/redact";

/**
 * Log an error raised while handling an oRPC call. Expected client errors (4xx)
 * get one short line so request payloads and session details do not end up in
 * the logs; unexpected errors keep their stack but never the raw error object
 * (provider SDK errors carry the request, including its Authorization header).
 */
export const logRpcError = (error: unknown) => {
	if (error instanceof ORPCError && error.status < 500) {
		console.warn(`[orpc] ${error.status} ${error.code}: ${error.message}`);
		return;
	}
	const stack = error instanceof Error && error.stack ? error.stack : "";
	console.error(
		"[orpc] unexpected error:",
		describeError(error),
		stack ? `\n${redactSecrets(stack)}` : "",
	);
};
