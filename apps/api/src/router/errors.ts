import { ORPCError } from "@orpc/server";
import { isAPIError } from "better-auth/api";

const CODE_BY_STATUS: Record<number, string> = {
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	405: "METHOD_NOT_SUPPORTED",
	409: "CONFLICT",
	413: "PAYLOAD_TOO_LARGE",
	415: "UNSUPPORTED_MEDIA_TYPE",
	422: "UNPROCESSABLE_CONTENT",
	429: "TOO_MANY_REQUESTS",
	500: "INTERNAL_SERVER_ERROR",
	502: "BAD_GATEWAY",
	503: "SERVICE_UNAVAILABLE",
};

/**
 * Convert a better-auth APIError into an ORPCError that keeps its HTTP status
 * and message (oRPC would otherwise turn it into a 500). Any other error is
 * returned unchanged.
 */
export const toORPCError = (error: unknown): unknown => {
	if (error instanceof ORPCError || !isAPIError(error)) return error;

	const apiError = error as {
		statusCode?: number;
		message?: string;
		body?: { message?: string; code?: string };
	};
	const status =
		apiError.statusCode && apiError.statusCode >= 400 && apiError.statusCode < 600
			? apiError.statusCode
			: 500;
	const code =
		CODE_BY_STATUS[status] ??
		(status < 500 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR");

	return new ORPCError(code, {
		status,
		message: apiError.body?.message || apiError.message || undefined,
		data: apiError.body?.code ? { code: apiError.body.code } : undefined,
		cause: error,
	});
};
