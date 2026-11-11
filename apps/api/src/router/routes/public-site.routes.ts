import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { orgManagerProcedure } from "../middleware";
import { hasAdminRole } from "../access";
import {
	deletePublicSite,
	listPublicSites,
	upsertPublicSite,
} from "../../services/public-site.service";
import {
	assertPublicSiteAdmin,
	hostnameSchema,
	publicSiteSettingsSchema,
} from "../../utils/public_site";
import { env } from "../../config/env";

// Hostnames decide which site a Host header serves, so only a global admin may
// register them (any org owner could otherwise claim a hostname).
const adminOnly = orgManagerProcedure.use(async ({ context, next }) => {
	assertPublicSiteAdmin(context.user.role, hasAdminRole);
	return next();
});

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const publicSiteRoutes = {
	upsert: adminOnly
		.route({
			method: "PUT",
			path: `${PREFIX}/public-sites/{hostname}`,
			description:
				"Create or update a public site: a hostname that serves a no-sign-in chat with one of your knowledge bases. Chats are billed to the active organization.",
		})
		.input(
			z.object({
				hostname: hostnameSchema,
				profileId: z.string().min(1),
				enabled: z.boolean().optional(),
				settings: publicSiteSettingsSchema.optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			upsertPublicSite({
				...input,
				userId: context.user.id,
				organizationId: context.organizationId,
			}),
		),

	list: orgManagerProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/public-sites`,
			description: "List the public sites of the active organization",
		})
		.handler(async ({ context }) => ({
			sites: await listPublicSites(context.organizationId),
		})),

	delete: adminOnly
		.route({
			method: "DELETE",
			path: `${PREFIX}/public-sites/{hostname}`,
			description: "Delete a public site of the active organization",
		})
		.input(z.object({ hostname: hostnameSchema }))
		.handler(async ({ input, context }) => {
			const deleted = await deletePublicSite(
				input.hostname,
				context.organizationId,
			);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Site not found" });
			}
			return { message: "Site deleted" };
		}),
};
