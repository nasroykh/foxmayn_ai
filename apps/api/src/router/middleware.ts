import { os, ORPCError } from "@orpc/server";
import { db, apikey } from "@repo/db";
import { eq } from "@repo/db/drizzle-orm";
import { auth } from "../config/auth";
import { API_KEY_HEADER } from "../config/constants";
import { hasEnoughCredits } from "../services/credits.service";
import { getMemberRole } from "../services/organization.service";
import {
	hasAdminRole,
	isOrgManager,
	isUserBanned,
	parseApiKeyOrganizationId,
} from "./access";
import { toORPCError } from "./errors";

export { hasAdminRole } from "./access";

/** Organization an API key is bound to (stored in its metadata at creation). */
const getApiKeyOrganizationId = async (
	apiKeyId: string,
): Promise<string | null> => {
	const [row] = await db
		.select({ metadata: apikey.metadata })
		.from(apikey)
		.where(eq(apikey.id, apiKeyId))
		.limit(1);

	return parseApiKeyOrganizationId(row?.metadata);
};

// Every procedure goes through this, so better-auth APIErrors thrown by the
// service wrappers keep their HTTP status instead of becoming a 500.
const root = os.$context<{ headers: Headers }>();

const base = root.use(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		throw toORPCError(error);
	}
});

const authMiddleware = root.middleware(async ({ context, next }) => {
	const sessionData = await auth.api.getSession({
		headers: context.headers,
	});

	if (!sessionData?.session || !sessionData?.user) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Session expired or invalid",
		});
	}

	// Banned users are rejected here because API-key sessions never go through
	// better-auth's session creation hook, which is where it checks bans.
	if (isUserBanned(sessionData.user)) {
		throw new ORPCError("FORBIDDEN", {
			message: "This account has been banned",
		});
	}

	// With enableSessionForAPIKeys, better-auth answers the session from the
	// key header and the mock session id is the API key id.
	const isApiKeySession = Boolean(context.headers.get(API_KEY_HEADER));

	// Adds session and user to the context
	return next({
		context: {
			session: sessionData.session,
			user: sessionData.user,
			isApiKeySession,
			apiKeyId: isApiKeySession ? sessionData.session.id : null,
		},
	});
});

export const publicProcedure = base;

export const authProcedure = base.use(authMiddleware);

/**
 * Like authProcedure but only for browser sessions: API keys are rejected so a
 * leaked key cannot manage keys.
 */
export const sessionProcedure = authProcedure.use(async ({ context, next }) => {
	if (context.isApiKeySession) {
		throw new ORPCError("FORBIDDEN", {
			message: "This endpoint cannot be used with an API key",
		});
	}

	return next({ context });
});

export const adminProcedure = sessionProcedure.use(async ({ context, next }) => {
	if (!hasAdminRole(context.user.role)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Admin access required",
		});
	}

	return next({ context });
});

/**
 * Requires an active organization and checks the user is a member of it.
 * Injects `organizationId` and `memberRole` into the context.
 *
 * Browser sessions use `session.activeOrganizationId`; API keys use the
 * organization stored in the key's metadata.
 */
export const orgProcedure = authProcedure.use(async ({ context, next }) => {
	let orgId: string | null | undefined;

	if (context.apiKeyId) {
		orgId = await getApiKeyOrganizationId(context.apiKeyId);
		if (!orgId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "This API key is not bound to an organization.",
			});
		}
	} else {
		orgId = context.session.activeOrganizationId;
		if (!orgId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "No active organization. Set an active organization first.",
			});
		}
	}

	// A removed member can keep a live session or key, so membership is checked
	// on every request instead of trusting the session.
	const memberRole = await getMemberRole(context.user.id, orgId);
	if (!memberRole) {
		throw new ORPCError("FORBIDDEN", {
			message: "You are not a member of this organization",
		});
	}

	return next({
		context: {
			...context,
			organizationId: orgId,
			memberRole,
		},
	});
});

/**
 * Organization owners and admins only (credits history, usage statistics).
 */
export const orgManagerProcedure = orgProcedure.use(
	async ({ context, next }) => {
		if (!isOrgManager(context.memberRole)) {
			throw new ORPCError("FORBIDDEN", {
				message: "Organization owner or admin access required",
			});
		}

		return next({ context });
	},
);

/**
 * Requires an active organization AND sufficient credits.
 * Use this for AI-consuming endpoints (chat, embedding, indexing).
 *
 * This is a fast-fail guard — it prevents wasted work for clearly broke orgs.
 * The hard enforcement happens inside logUsageAndDeduct(), which throws if
 * the atomic deduction fails regardless of what this check returned.
 */
export const creditsProcedure = orgProcedure.use(async ({ context, next }) => {
	const hasCredits = await hasEnoughCredits(
		context.organizationId,
		0.001, // ~$0.001 minimum — enough for at least a small embedding call
	);

	if (!hasCredits) {
		throw new ORPCError("FORBIDDEN", {
			message:
				"Insufficient credits. Please top up your organization's balance.",
		});
	}

	return next({ context });
});
