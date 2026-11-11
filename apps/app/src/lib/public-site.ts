import type { RouterOutputs } from "./orpc";
import { API_URL } from "./api-url";

export type PublicSiteInfo = RouterOutputs["public"]["site"];

const DEFAULT_WAIT_MINUTES = 10;

/**
 * Text for a 429: the site's own (`{minutes}` replaced by the wait) or the
 * French default. Without a known wait it assumes the IP window (10 minutes).
 */
export function rateLimitMessage(
	template: string | undefined,
	retryAfterSeconds: unknown,
): string {
	const minutes =
		typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
			? Math.max(1, Math.ceil(retryAfterSeconds / 60))
			: DEFAULT_WAIT_MINUTES;
	if (template) return template.replaceAll("{minutes}", String(minutes));
	return `Trop de messages, réessayez dans ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

// A slow API must not hold the normal app back for long
const FETCH_TIMEOUT_MS = 4000;

/**
 * The public site of this hostname (the API reads the Host header), or null
 * when there is none or the request fails. Plain fetch: no auth, no client.
 */
export async function fetchPublicSite(): Promise<PublicSiteInfo | null> {
	try {
		const response = await fetch(`${API_URL}/public/site`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const data: unknown = await response.json();
		if (
			!data ||
			typeof data !== "object" ||
			typeof (data as { assistantName?: unknown }).assistantName !== "string"
		) {
			return null;
		}
		return data as PublicSiteInfo;
	} catch {
		return null;
	}
}
