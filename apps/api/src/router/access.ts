/**
 * Pure helpers for the auth middleware (no env, db or auth imports so they
 * stay unit-testable).
 */

import { ORPCError } from "@orpc/server";

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

/** What an API key is bound to, from its metadata. */
export type ApiKeyScope = {
	organizationId: string | null;
	/** Knowledge base (RAG profile) a chat-only key is limited to. */
	profileId: string | null;
};

const nonEmptyString = (value: unknown): string | null =>
	typeof value === "string" && value ? value : null;

/**
 * Read the organization and knowledge base stored in an API key's metadata.
 * The column holds JSON text, and legacy rows can be double-stringified.
 */
export const parseApiKeyScope = (raw: unknown): ApiKeyScope => {
	const none: ApiKeyScope = { organizationId: null, profileId: null };
	let value: unknown = raw;
	for (let i = 0; i < 2 && typeof value === "string"; i++) {
		try {
			value = JSON.parse(value);
		} catch {
			return none;
		}
	}
	if (!value || typeof value !== "object") return none;
	const metadata = value as { organizationId?: unknown; profileId?: unknown };
	return {
		organizationId: nonEmptyString(metadata.organizationId),
		profileId: nonEmptyString(metadata.profileId),
	};
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

/**
 * Knowledge base (profile) for a request. A key bound to one knowledge base
 * always uses it and cannot name another; other callers choose freely (and
 * their profile ownership is checked when it is loaded).
 */
export function resolveKnowledgeBase(
	requestedProfileId: string | undefined,
	apiKeyProfileId: string | null,
): string | undefined {
	if (!apiKeyProfileId) return requestedProfileId;
	if (requestedProfileId && requestedProfileId !== apiKeyProfileId) {
		throw new ORPCError("FORBIDDEN", {
			message: "This API key is limited to another knowledge base",
		});
	}
	return apiKeyProfileId;
}
