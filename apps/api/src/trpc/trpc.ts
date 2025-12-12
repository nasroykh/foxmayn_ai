import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import SuperJSON from "superjson";

const t = initTRPC.context<Context>().create({
	transformer: SuperJSON,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.user) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
		});
	}

	return next({
		ctx: {
			...ctx,
			user: ctx.user,
		},
	});
});
