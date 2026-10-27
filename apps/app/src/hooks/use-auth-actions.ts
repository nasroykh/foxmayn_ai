import { useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { ensureActiveOrganization } from "@/lib/organization";
import {
	dropSessionState,
	queryClient,
} from "@/lib/query-client";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Session-mutating actions that must also reset client state. Every action
 * that changes who the user is, or which organization is active, goes through
 * here so cached data from the previous identity never leaks into the next.
 */
export function useAuthActions() {
	const router = useRouter();

	/** After a successful sign-in: sets the org, resets caches, goes to `redirectTo`. */
	const completeLogin = async (redirectTo?: string) => {
		await ensureActiveOrganization();
		queryClient.clear();
		router.history.replace(safeRedirect(redirectTo) ?? "/");
	};

	const logout = async () => {
		await authClient.signOut();
		await dropSessionState(() =>
			router.navigate({ to: "/auth/login", replace: true }),
		);
	};

	/** Switches the active organization and refetches everything for it. */
	const switchOrganization = async (organizationId: string) => {
		const { error } = await authClient.organization.setActive({
			organizationId,
		});
		if (error) throw new Error(error.message || "Failed to switch organization");
		await queryClient.resetQueries();
		await router.invalidate();
	};

	/** Admin: act as another user. Resets caches since the identity changes. */
	const startImpersonation = async (userId: string) => {
		const { error } = await authClient.admin.impersonateUser({ userId });
		if (error) throw new Error(error.message || "Failed to impersonate user");
		await ensureActiveOrganization();
		queryClient.clear();
		await router.navigate({ to: "/", replace: true });
	};

	const stopImpersonation = async () => {
		const { error } = await authClient.admin.stopImpersonating();
		if (error) throw new Error(error.message || "Failed to stop impersonating");
		queryClient.clear();
		await router.navigate({ to: "/admin/users", replace: true });
	};

	return {
		completeLogin,
		logout,
		switchOrganization,
		startImpersonation,
		stopImpersonation,
	};
}
