import { ORPCError } from "@orpc/server";
import { errorStatus } from "../config/redact";

/** HTTP statuses where the same request can never succeed on retry. */
const PERMANENT_PROVIDER_STATUSES = new Set([400, 401, 402, 403, 404]);

/** True when retrying the provider call cannot help (bad key, unknown model, ...). */
export const isPermanentProviderError = (error: unknown): boolean => {
	const status = errorStatus(error);
	return status !== undefined && PERMANENT_PROVIDER_STATUSES.has(status);
};

/** User-safe reason for a document whose indexing the provider refused. */
export const PROVIDER_REFUSED_INDEXING_REASON =
	"The AI provider rejected the indexing request. Check the embedding model or contact support.";

/**
 * Chat provider failure as a clean API error, without provider details.
 * 4xx from the provider -> BAD_GATEWAY; 429, 5xx, network, timeout -> SERVICE_UNAVAILABLE.
 */
export const toChatProviderError = (error: unknown): ORPCError<string, unknown> => {
	if (error instanceof ORPCError) return error;
	const status = errorStatus(error);
	if (status !== undefined && status < 500 && status !== 429) {
		return new ORPCError("BAD_GATEWAY", {
			message: "The AI provider rejected the request",
		});
	}
	return new ORPCError("SERVICE_UNAVAILABLE", {
		message: "The AI provider is temporarily unavailable. Try again shortly.",
	});
};
