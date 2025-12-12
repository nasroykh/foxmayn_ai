import { authClient } from "./auth";

/**
 * Ensures the user has an active organization.
 * Creates a default organization if user has none, or sets the first one as active.
 *
 * @param userName - The user's display name (used for default org naming)
 * @returns The active organization ID, or null if setup failed
 */
export async function ensureActiveOrganization(
	userName: string
): Promise<string | null> {
	try {
		const orgsRes = await authClient.organization.list();

		if (!orgsRes.data?.length) {
			// User has no organizations - create a default one
			const slug = userName
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "");

			const orgRes = await authClient.organization.create({
				name: `${userName}'s Organization`,
				slug: `${slug}-${Date.now()}`,
			});

			if (orgRes.error || !orgRes.data) {
				console.error("Failed to create organization:", orgRes.error);
				return null;
			}

			await authClient.organization.setActive({
				organizationId: orgRes.data.id,
			});

			return orgRes.data.id;
		}

		// User has organizations - ensure one is active
		const activeOrg = await authClient.organization.getFullOrganization();
		if (activeOrg.data) {
			return activeOrg.data.id;
		}

		// No active org, set the first one
		if (orgsRes.data[0]) {
			await authClient.organization.setActive({
				organizationId: orgsRes.data[0].id,
			});
			return orgsRes.data[0].id;
		}

		return null;
	} catch (error) {
		console.error("Failed to ensure active organization:", error);
		return null;
	}
}
