import { db, member, organization } from "@repo/db";
import { and, asc, count, eq, ilike, or, sql } from "@repo/db/drizzle-orm";
import { auth } from "../config/auth";
import { createTtlCache } from "../router/access";
import { escapeLike } from "../utils/sql";

// A removed member keeps access for up to this long
const MEMBERSHIP_CACHE_TTL_MS = 15_000;
const membershipCache = createTtlCache<string>(MEMBERSHIP_CACHE_TTL_MS);

/**
 * Role of `userId` in `organizationId`, or null when they are not a member.
 * Only positive results are cached so new members get access immediately.
 */
export async function getMemberRole(
	userId: string,
	organizationId: string,
): Promise<string | null> {
	const cacheKey = `${userId}:${organizationId}`;
	const cached = membershipCache.get(cacheKey);
	if (cached) return cached;

	const [row] = await db
		.select({ role: member.role })
		.from(member)
		.where(
			and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
		)
		.limit(1);

	if (!row) return null;
	membershipCache.set(cacheKey, row.role);
	return row.role;
}

// =============================================================================
// Types
// =============================================================================

export type CreateOrganizationInput = {
	name: string;
	slug: string;
	logo?: string;
	metadata?: Record<string, unknown>;
};

export type UpdateOrganizationInput = {
	name?: string;
	slug?: string;
	logo?: string;
	metadata?: Record<string, unknown>;
};

export type InviteMemberInput = {
	email: string;
	role: "member" | "admin" | "owner";
	organizationId: string;
};

export type UpdateMemberRoleInput = {
	memberId: string;
	role: "member" | "admin" | "owner";
	organizationId: string;
};

export type RemoveMemberInput = {
	memberIdOrEmail: string;
	organizationId: string;
};

export type InvitationInput = {
	invitationId: string;
};

// =============================================================================
// Organization CRUD
// =============================================================================

export async function createOrganization(
	input: CreateOrganizationInput,
	headers: Headers,
) {
	return auth.api.createOrganization({
		body: {
			name: input.name,
			slug: input.slug,
			logo: input.logo,
			metadata: input.metadata,
			// Switching org changes the session cookie, which this wrapper cannot
			// forward. The client switches with authClient.organization.setActive.
			keepCurrentActiveOrganization: true,
		},
		headers,
	});
}

export async function updateOrganization(
	input: UpdateOrganizationInput,
	headers: Headers,
) {
	return auth.api.updateOrganization({
		body: { data: input },
		headers,
	});
}

export async function listOrganizations(headers: Headers) {
	return auth.api.listOrganizations({
		headers,
	});
}

export async function getFullOrganization(headers: Headers) {
	return auth.api.getFullOrganization({
		headers,
	});
}

// =============================================================================
// Member Management
// =============================================================================

export async function listMembers(headers: Headers) {
	return auth.api.listMembers({
		headers,
	});
}

export async function inviteMember(input: InviteMemberInput, headers: Headers) {
	return auth.api.createInvitation({
		body: input,
		headers,
	});
}

/** Drop cached roles of an organization (this replica only; entries last 15s). */
const forgetOrganizationRoles = (organizationId: string) => {
	membershipCache.deleteWhere((key) => key.endsWith(`:${organizationId}`));
};

export async function updateMemberRole(
	input: UpdateMemberRoleInput,
	headers: Headers,
) {
	try {
		return await auth.api.updateMemberRole({
			body: input,
			headers,
		});
	} finally {
		forgetOrganizationRoles(input.organizationId);
	}
}

export async function removeMember(input: RemoveMemberInput, headers: Headers) {
	try {
		return await auth.api.removeMember({
			body: input,
			headers,
		});
	} finally {
		forgetOrganizationRoles(input.organizationId);
	}
}

// =============================================================================
// Invitation Management
// =============================================================================

export async function getInvitation(invitationId: string, headers: Headers) {
	return auth.api.getInvitation({
		query: { id: invitationId },
		headers,
	});
}

export async function rejectInvitation(invitationId: string, headers: Headers) {
	return auth.api.rejectInvitation({
		body: { invitationId },
		headers,
	});
}

// ============================================================================
// Admin
// ============================================================================


/**
 * Every organization, for platform admins (credits top-up picker).
 * Paginated, optionally filtered by name or slug (case-insensitive substring).
 */
export async function adminListOrganizations(options: {
	limit: number;
	offset: number;
	search?: string;
}) {
	const term = options.search?.trim();
	const where = term
		? or(
				ilike(organization.name, `%${escapeLike(term)}%`),
				ilike(organization.slug, `%${escapeLike(term)}%`),
			)
		: undefined;

	const [organizations, [total]] = await Promise.all([
		db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				creditsBalance: organization.creditsBalance,
				memberCount: sql<number>`(select count(*)::int from ${member} where ${member.organizationId} = ${organization.id})`,
			})
			.from(organization)
			.where(where)
			.orderBy(asc(organization.name), asc(organization.id))
			.limit(options.limit)
			.offset(options.offset),
		db.select({ count: count() }).from(organization).where(where),
	]);

	return {
		organizations: organizations.map((org) => ({
			...org,
			creditsBalance: Number(org.creditsBalance),
		})),
		total: total?.count ?? 0,
	};
}
