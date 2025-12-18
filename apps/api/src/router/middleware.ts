import { os, ORPCError } from "@orpc/server";
import { auth } from "../config/auth";

const base = os.$context<{ headers: Headers }>();

const authMiddleware = base.middleware(async ({ context, next }) => {
	const sessionData = await auth.api.getSession({
		headers: context.headers,
	});

	if (!sessionData?.session || !sessionData?.user) {
		throw new ORPCError("UNAUTHORIZED");
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
