/**
 * Mirrors the API's `hasAdminRole` (apps/api/src/router/access.ts): a user
 * role may be a comma-separated list ("user,admin").
 */
export function hasAdminRole(role: string | null | undefined): boolean {
	if (!role) return false;
	return role
		.split(",")
		.map((r) => r.trim())
		.includes("admin");
}

/** Organization owners and admins (credits history, usage statistics). */
export function isOrgManager(role: string | null | undefined): boolean {
	if (!role) return false;
	return role
		.split(",")
		.map((r) => r.trim())
		.some((r) => r === "owner" || r === "admin");
}
