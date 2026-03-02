import { os, ORPCError } from "@orpc/server";
import { auth } from "../config/auth";
import { hasEnoughCredits } from "../services/credits.service";

const base = os.$context<{ headers: Headers }>();

const authMiddleware = base.middleware(async ({ context, next }) => {
	const sessionData = await auth.api.getSession({
		headers: context.headers,
	});

	if (!sessionData?.session || !sessionData?.user) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Session expired or invalid",
		});
	}

	// Adds session and user to the context
	return next({
		context: {
			session: sessionData.session,
			user: sessionData.user,
		},
	});
});

export const publicProcedure = base;

export const authProcedure = base.use(authMiddleware);

export const adminProcedure = base
	.use(authMiddleware)
	.use(async ({ context, next }) => {
		const userRole = context.user.role;

		// Check if user has admin role (can be comma-separated for multiple roles)
		const roles = userRole?.split(",").map((r: string) => r.trim()) ?? [];
		if (!roles.includes("admin")) {
			throw new ORPCError("FORBIDDEN", {
				message: "Admin access required",
			});
		}

		return next({ context });
	});

/**
 * Requires an active organization on the session.
 * Injects `organizationId` into the context.
 */
export const orgProcedure = base
	.use(authMiddleware)
	.use(async ({ context, next }) => {
		const orgId = context.session.activeOrganizationId;
		if (!orgId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "No active organization. Set an active organization first.",
			});
		}

		return next({
			context: {
				...context,
				organizationId: orgId,
			},
		});
	});

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
