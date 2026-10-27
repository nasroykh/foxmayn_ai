import { authClient } from "@/lib/auth";
import { isOrgManager } from "@/lib/roles";

/**
 * Role of the signed-in user in the active organization (owner | admin |
 * member, possibly comma-separated). Owner/admin-only API procedures
 * (credits.getTransactions, usage.getStats) must be gated on `isManager`.
 */
export function useMemberRole() {
	const { data, isPending } = authClient.useActiveMember();
	const role = data?.role ?? null;
	return {
		role,
		isPending,
		isManager: isOrgManager(role),
		isOwner: role?.split(",").map((r) => r.trim()).includes("owner") ?? false,
	};
}
