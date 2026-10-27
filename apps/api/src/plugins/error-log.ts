import { ORPCError } from "@orpc/server";

/**
 * Log an error raised while handling an oRPC call. Expected client errors (4xx)
 * get one short line so request payloads and session details do not end up in
 * the logs; unexpected errors keep their stack.
 */
export const logRpcError = (error: unknown) => {
	if (error instanceof ORPCError && error.status < 500) {
		console.warn(`[orpc] ${error.status} ${error.code}: ${error.message}`);
		return;
	}
	console.error("[orpc] unexpected error:", error);
};
