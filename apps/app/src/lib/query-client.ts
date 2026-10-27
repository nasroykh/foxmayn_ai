import {
	MutationCache,
	QueryCache,
	QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import { authClient, type SessionData } from "./auth";

/** True for 4xx oRPC errors (retrying them never helps). */
function isClientError(error: unknown): boolean {
	return (
		error instanceof ORPCError && error.status >= 400 && error.status < 500
	);
}

export function isUnauthorizedError(error: unknown): boolean {
	return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

// Set by main.tsx once the router exists (avoids a circular import).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
	onUnauthorized = handler;
}

let handlingUnauthorized = false;
function handleError(error: unknown) {
	if (!isUnauthorizedError(error) || handlingUnauthorized) return;
	handlingUnauthorized = true;
	// Let the redirect settle before another 401 can trigger it again.
	setTimeout(() => {
		handlingUnauthorized = false;
	}, 2000);
	onUnauthorized?.();
}

export const queryClient = new QueryClient({
	queryCache: new QueryCache({ onError: handleError }),
	mutationCache: new MutationCache({ onError: handleError }),
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: (failureCount, error) =>
				!isClientError(error) && failureCount < 2,
		},
	},
});

/**
 * The better-auth session, cached so route guards do not hit the network on
 * every navigation. Cleared on login, logout, org switch (see `resetAppState`).
 */
export const sessionQueryOptions = queryOptions({
	queryKey: ["auth", "session"],
	queryFn: async (): Promise<SessionData> => {
		const res = await authClient.getSession();
		// Throw on transport/server errors so they are not cached as "logged out"
		if (res.error) throw new Error(res.error.message || "Failed to load session");
		return res.data ?? null;
	},
	staleTime: Infinity,
	gcTime: Infinity,
	retry: false,
});

/**
 * Logout / expired session: marks the session as gone, navigates away from the
 * authenticated screens, then drops every cached query so one user's (or one
 * tenant's) data can never render for the next login.
 */
export async function dropSessionState(navigate: () => Promise<unknown>) {
	queryClient.setQueryData(sessionQueryOptions.queryKey, null);
	try {
		await navigate();
	} finally {
		queryClient.clear();
	}
}
