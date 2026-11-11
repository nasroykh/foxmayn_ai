/**
 * Pure helpers of public sites (hostname rules, settings schema, request IP,
 * access decisions). No env, db or redis imports so they stay unit-testable.
 */

import { ORPCError } from "@orpc/server";
import { z } from "zod";

export const MAX_HOSTNAME_CHARS = 253;
const MAX_LABEL_CHARS = 63;
// One DNS label: letters, digits and inner hyphens
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Hostname of a Host header or a path parameter: trimmed, lowercase, without
 * port and trailing dot. Not validated; see `isValidHostname`.
 */
export const normalizeHostname = (raw: string | null | undefined): string => {
	let host = (raw ?? "").trim().toLowerCase();
	// IPv6 literals never are valid site hostnames; leave them for validation to reject
	if (!host.startsWith("[")) host = host.replace(/:\d*$/, "");
	return host.replace(/\.$/, "");
};

/** Lowercase letters, digits, dots and hyphens; at least one dot; at most 253 characters. */
export const isValidHostname = (host: string): boolean => {
	if (!host || host.length > MAX_HOSTNAME_CHARS || !host.includes(".")) return false;
	return host
		.split(".")
		.every((label) => label.length <= MAX_LABEL_CHARS && LABEL_PATTERN.test(label));
};

/** A site hostname as a client sends it: normalized, then validated. */
export const hostnameSchema = z
	.string()
	.transform(normalizeHostname)
	.refine(
		isValidHostname,
		"Hostname must be lowercase letters, digits, dots and hyphens, with at least one dot",
	);

/** UI text of a public site. Unknown keys are rejected. */
export const publicSiteSettingsSchema = z.strictObject({
	title: z.string().trim().max(100).optional(),
	subtitle: z.string().trim().max(200).optional(),
	placeholder: z.string().trim().max(100).optional(),
	disclaimer: z.string().trim().max(300).optional(),
	suggestions: z.array(z.string().trim().min(1).max(150)).max(6).optional(),
	supportText: z.string().trim().max(300).optional(),
	// Shown on a 429; `{minutes}` is replaced by the wait
	rateLimitText: z.string().trim().max(200).optional(),
});

export const MAX_IP_CHARS = 64;
export const UNKNOWN_IP = "unknown";

/**
 * Client IP for rate limiting: `x-real-ip`, which Caddy (apps/app/Caddyfile)
 * overwrites with the client address. A missing or oversized value shares one
 * "unknown" bucket.
 */
export const clientIpFromHeaders = (headers: Pick<Headers, "get">): string => {
	const ip = headers.get("x-real-ip")?.trim();
	return ip && ip.length <= MAX_IP_CHARS ? ip : UNKNOWN_IP;
};

/** Hostname of the app's own public URL (`APP_URL`); a site can never take it. */
export const appHostOf = (appUrl: string): string => {
	try {
		return normalizeHostname(new URL(appUrl).host);
	} catch {
		return "";
	}
};

export const reservedHostnameError = () =>
	new ORPCError("BAD_REQUEST", {
		message: "This hostname is reserved for the app itself",
	});

/** The app's own host cannot be a public site. */
export const assertNotAppHost = (hostname: string, appHost: string): void => {
	if (appHost && hostname === appHost) throw reservedHostnameError();
};

/** Global admin role check for managing public sites. */
export const assertPublicSiteAdmin = (
	role: string | null | undefined,
	isAdmin: (role: string | null | undefined) => boolean,
): void => {
	if (!isAdmin(role)) {
		throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
	}
};

export const PUBLIC_UNAVAILABLE_MESSAGE = "The assistant is unavailable right now.";

/**
 * Error a visitor may see. Credit, billing and cap refusals (403) and an
 * unsupported model say too much about the owner's account, so they become one
 * generic 503. Everything else (404, 429, ...) is kept. Logs the real reason.
 */
export const toPublicChatError = (error: unknown): unknown => {
	if (!(error instanceof ORPCError)) return error;
	const hidden =
		error.code === "FORBIDDEN" ||
		(error.code === "BAD_REQUEST" && /^Unsupported model/.test(error.message));
	if (!hidden) return error;
	console.error("[public-chat] refused:", error.code, error.message);
	return new ORPCError("SERVICE_UNAVAILABLE", {
		message: PUBLIC_UNAVAILABLE_MESSAGE,
	});
};

/** An unknown or disabled site is a plain 404, so hostnames cannot be probed. */
export const requireEnabledSite = <T extends { enabled: boolean }>(
	site: T | null | undefined,
): T => {
	if (!site || !site.enabled) {
		throw new ORPCError("NOT_FOUND", { message: "Site not found" });
	}
	return site;
};

export const hostnameTakenError = () =>
	new ORPCError("CONFLICT", {
		message: "This hostname belongs to another organization",
	});

/** A hostname already owned by another organization cannot be taken over. */
export const assertHostnameAvailable = (
	existing: { organizationId: string } | null | undefined,
	organizationId: string,
): void => {
	if (existing && existing.organizationId !== organizationId) {
		throw hostnameTakenError();
	}
};

/**
 * The enabled site a Host header names, else 404. The user that runs the chat
 * must still be a member of the billed organization and not banned: a removed
 * or banned member's site stops instead of spending the organization's credits.
 * The app's own host is never a site.
 */
export const resolveSiteWith = async <
	T extends { enabled: boolean; userId: string; organizationId: string },
>(
	deps: {
		findSite: (hostname: string) => Promise<T | null>;
		getMemberRole: (userId: string, organizationId: string) => Promise<unknown>;
		/** True when the user is banned (Better Auth `user.banned`). */
		isUserBanned: (userId: string) => Promise<boolean>;
		/** Host of the app's own URL; never served as a site. */
		appHost: string;
	},
	hostHeader: string | null | undefined,
): Promise<T> => {
	const hostname = normalizeHostname(hostHeader);
	if (deps.appHost && hostname === deps.appHost) requireEnabledSite(null);
	const site = requireEnabledSite(await deps.findSite(hostname));
	if (await deps.isUserBanned(site.userId)) requireEnabledSite(null);
	const role = await deps.getMemberRole(site.userId, site.organizationId);
	return requireEnabledSite(role ? site : null);
};

/**
 * Create or update a site. The profile must belong to `userId` (the user the
 * chat runs as), else 404. A hostname of another organization is a 409, both
 * when seen up front and when `saveSite` loses a race for it (returns null).
 */
export const upsertSiteWith = async <TSite>(
	deps: {
		getProfile: (profileId: string, userId: string) => Promise<unknown>;
		findSite: (hostname: string) => Promise<{ organizationId: string } | null>;
		/** Insert or update; null when the hostname belongs to another organization. */
		saveSite: (input: {
			hostname: string;
			organizationId: string;
			changes: Record<string, unknown>;
		}) => Promise<TSite | null>;
	},
	input: {
		hostname: string;
		profileId: string;
		enabled?: boolean;
		settings?: unknown;
		userId: string;
		organizationId: string;
		/** Host of the app's own URL, which cannot be a site. */
		appHost: string;
	},
): Promise<TSite> => {
	const { hostname, userId, organizationId } = input;

	assertNotAppHost(hostname, input.appHost);
	if (!(await deps.getProfile(input.profileId, userId))) {
		throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
	}
	assertHostnameAvailable(await deps.findSite(hostname), organizationId);

	const saved = await deps.saveSite({
		hostname,
		organizationId,
		changes: {
			profileId: input.profileId,
			userId,
			...(input.enabled !== undefined && { enabled: input.enabled }),
			...(input.settings !== undefined && { settings: input.settings }),
		},
	});
	if (!saved) throw hostnameTakenError();
	return saved;
};

/** What an anonymous visitor may know of a retrieved source. */
export type PublicSource = { title: string; source: string | null };

/**
 * Sources for the public stream: title and source only, never the chunk text
 * or ids. Order and length are kept, because the answer cites sources as [n]
 * by position.
 */
export const toPublicSources = (
	sources: ReadonlyArray<{ title: string; source: string | null }>,
): PublicSource[] =>
	sources.map(({ title, source }) => ({ title, source }));
