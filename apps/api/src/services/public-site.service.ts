import { db, publicSite, type PublicSiteSettings } from "@repo/db";
import { and, desc, eq } from "@repo/db/drizzle-orm";
import { ORPCError } from "@orpc/server";
import { getProfile } from "./profile.service";
import { getMemberRole } from "./organization.service";
import { resolveSiteWith, upsertSiteWith } from "../utils/public_site";

export type PublicSite = typeof publicSite.$inferSelect;

const findSite = async (hostname: string): Promise<PublicSite | null> => {
	const [site] = await db
		.select()
		.from(publicSite)
		.where(eq(publicSite.hostname, hostname))
		.limit(1);
	return site ?? null;
};

/** The enabled site a request's Host header names, else 404 (see `resolveSiteWith`). */
export const resolvePublicSite = (
	hostHeader: string | null | undefined,
): Promise<PublicSite> =>
	resolveSiteWith({ findSite, getMemberRole }, hostHeader);

/** What a visitor may see of a site: its profile's names and the UI text. */
export const getPublicSiteInfo = async (site: PublicSite) => {
	const profile = await getProfile(site.profileId, site.userId);
	if (!profile) throw new ORPCError("NOT_FOUND", { message: "Site not found" });
	return {
		hostname: site.hostname,
		assistantName: profile.assistantName,
		companyName: profile.companyName,
		settings: site.settings,
	};
};

export const listPublicSites = async (organizationId: string) =>
	db
		.select()
		.from(publicSite)
		.where(eq(publicSite.organizationId, organizationId))
		.orderBy(desc(publicSite.createdAt));

/**
 * Create or update a site: the profile must belong to `userId`, who runs the
 * chat; `organizationId` is billed. Omitted `enabled` and `settings` keep their
 * stored values (defaults on create).
 */
export const upsertPublicSite = (input: {
	hostname: string;
	profileId: string;
	enabled?: boolean;
	settings?: PublicSiteSettings;
	userId: string;
	organizationId: string;
}): Promise<PublicSite> =>
	upsertSiteWith(
		{
			getProfile,
			findSite,
			// The conflict guard is part of the statement, so two organizations
			// racing for a new hostname cannot both win.
			saveSite: async ({ hostname, organizationId, changes }) => {
				const [row] = await db
					.insert(publicSite)
					.values({ hostname, organizationId, ...changes } as typeof publicSite.$inferInsert)
					.onConflictDoUpdate({
						target: publicSite.hostname,
						set: { ...changes, updatedAt: new Date() },
						setWhere: eq(publicSite.organizationId, organizationId),
					})
					.returning();
				return row ?? null;
			},
		},
		input,
	);

/** Delete a site of the organization. Returns false when it has none by that hostname. */
export const deletePublicSite = async (
	hostname: string,
	organizationId: string,
): Promise<boolean> => {
	const rows = await db
		.delete(publicSite)
		.where(
			and(
				eq(publicSite.hostname, hostname),
				eq(publicSite.organizationId, organizationId),
			),
		)
		.returning({ hostname: publicSite.hostname });
	return rows.length > 0;
};
