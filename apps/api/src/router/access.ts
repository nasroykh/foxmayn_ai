/**
 * Pure helpers for the auth middleware (no env, db or auth imports so they
 * stay unit-testable).
 */

/** Role check on a user's role (can be comma-separated for multiple roles). */
export const hasRole = (
	role: string | null | undefined,
	allowed: readonly string[],
): boolean => {
	const roles = role?.split(",").map((r) => r.trim()) ?? [];
	return allowed.some((r) => roles.includes(r));
};

export const hasAdminRole = (role: string | null | undefined): boolean =>
	hasRole(role, ["admin"]);

/** User fields that decide access: an admin must not change them on their own account. */
const PRIVILEGED_USER_FIELDS = ["role", "banned", "banReason", "banExpires"];

export const touchesPrivilegedUserFields = (
	data: Record<string, unknown>,
): boolean => PRIVILEGED_USER_FIELDS.some((field) => field in data);

/** Organization roles allowed to read credits and usage of the whole org. */
export const ORG_MANAGER_ROLES = ["owner", "admin"] as const;

export const isOrgManager = (role: string | null | undefined): boolean =>
	hasRole(role, ORG_MANAGER_ROLES);

/** A user is banned until `banExpires`, or forever when it is not set. */
export const isUserBanned = (
	user: { banned?: boolean | null; banExpires?: Date | string | null },
	now: number = Date.now(),
): boolean => {
	if (!user.banned) return false;
	if (!user.banExpires) return true;
	return new Date(user.banExpires).getTime() > now;
};

/**
 * Read the organization id stored in an API key's metadata. The column holds
 * JSON text, and legacy rows can be double-stringified.
 */
export const parseApiKeyOrganizationId = (raw: unknown): string | null => {
	let value: unknown = raw;
	for (let i = 0; i < 2 && typeof value === "string"; i++) {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object") return null;
	const organizationId = (value as { organizationId?: unknown }).organizationId;
	return typeof organizationId === "string" && organizationId
		? organizationId
		: null;
};

export type TtlCache<V> = {
	get(key: string): V | undefined;
	set(key: string, value: V): void;
	delete(key: string): void;
	/** Remove every entry whose key matches. */
	deleteWhere(predicate: (key: string) => boolean): void;
	clear(): void;
};

/** Small in-memory cache whose entries expire after `ttlMs`. */
export const createTtlCache = <V>(
	ttlMs: number,
	maxEntries = 5000,
	now: () => number = Date.now,
): TtlCache<V> => {
	const entries = new Map<string, { value: V; expiresAt: number }>();

	return {
		get(key) {
			const entry = entries.get(key);
			if (!entry) return undefined;
			if (entry.expiresAt <= now()) {
				entries.delete(key);
				return undefined;
			}
			return entry.value;
		},
		set(key, value) {
			if (entries.size >= maxEntries && !entries.has(key)) {
				// Drop expired entries first, then the oldest one
				const t = now();
				for (const [k, e] of entries) if (e.expiresAt <= t) entries.delete(k);
				if (entries.size >= maxEntries) {
					const oldest = entries.keys().next().value;
					if (oldest !== undefined) entries.delete(oldest);
				}
			}
			entries.set(key, { value, expiresAt: now() + ttlMs });
		},
		delete(key) {
			entries.delete(key);
		},
		deleteWhere(predicate) {
			for (const key of entries.keys()) if (predicate(key)) entries.delete(key);
		},
		clear() {
			entries.clear();
		},
	};
};
