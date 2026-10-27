import { z } from "zod";

import { authProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	createOrganization,
	updateOrganization,
	listOrganizations,
	getFullOrganization,
	listMembers,
	inviteMember,
	updateMemberRole,
	removeMember,
	getInvitation,
	rejectInvitation,
} from "../../services/organization.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// =============================================================================
// Schemas
// =============================================================================

const createOrgSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1),
	logo: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateOrgSchema = z.object({
	name: z.string().min(1).optional(),
	slug: z.string().min(1).optional(),
	logo: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

const inviteMemberSchema = z.object({
	email: z.string().email(),
	role: z.enum(["member", "admin", "owner"]),
	organizationId: z.string(),
});

const updateMemberRoleSchema = z.object({
	memberId: z.string(),
	role: z.enum(["member", "admin", "owner"]),
	organizationId: z.string(),
});

const removeMemberSchema = z.object({
	memberIdOrEmail: z.string(),
	organizationId: z.string(),
});

const invitationIdSchema = z.object({
	invitationId: z.string(),
});

// =============================================================================
// Organization Routes
// =============================================================================

export const organizationRoutes = {
	// -------------------------------------------------------------------------
	// Create Organization
	// -------------------------------------------------------------------------
	create: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/organizations`,
			description: "Create a new organization",
		})
		.input(createOrgSchema)
		.handler(async ({ input, context }) => {
			return createOrganization(input, context.headers);
		}),

	// -------------------------------------------------------------------------
	// Update Organization
	// -------------------------------------------------------------------------
	update: authProcedure
		.route({
			method: "PATCH",
			path: `${PREFIX}/organizations`,
			description: "Update current organization",
		})
		.input(updateOrgSchema)
		.handler(async ({ input, context }) => {
			return updateOrganization(input, context.headers);
		}),

	// -------------------------------------------------------------------------
	// List Organizations
	// -------------------------------------------------------------------------
	list: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/organizations`,
			description: "List all organizations for current user",
		})
		.handler(async ({ context }) => {
			return listOrganizations(context.headers);
		}),

	// -------------------------------------------------------------------------
	// Get Full Organization
	// -------------------------------------------------------------------------
	getFullOrganization: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/organizations/current`,
			description: "Get current organization with full details",
		})
		.handler(async ({ context }) => {
			return getFullOrganization(context.headers);
		}),

	// -------------------------------------------------------------------------
	// List Members
	// -------------------------------------------------------------------------
	listMembers: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/organizations/members`,
			description: "List members of current organization",
		})
		.handler(async ({ context }) => {
			return listMembers(context.headers);
		}),

	// -------------------------------------------------------------------------
	// Invite Member
	// -------------------------------------------------------------------------
	inviteMember: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/organizations/members/invite`,
			description: "Invite a new member to organization",
		})
		.input(inviteMemberSchema)
		.handler(async ({ input, context }) => {
			return inviteMember(input, context.headers);
		}),

	// -------------------------------------------------------------------------
	// Update Member Role
	// -------------------------------------------------------------------------
	updateMemberRole: authProcedure
		.route({
			method: "PATCH",
			path: `${PREFIX}/organizations/members/role`,
			description: "Update member role in organization",
		})
		.input(updateMemberRoleSchema)
		.handler(async ({ input, context }) => {
			return updateMemberRole(input, context.headers);
		}),

	// -------------------------------------------------------------------------
	// Remove Member
	// -------------------------------------------------------------------------
	removeMember: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/organizations/members`,
			description: "Remove member from organization",
		})
		.input(removeMemberSchema)
		.handler(async ({ input, context }) => {
			return removeMember(input, context.headers);
		}),

	// -------------------------------------------------------------------------
	// Get Invitation
	// -------------------------------------------------------------------------
	getInvitation: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/organizations/invitations/{invitationId}`,
			description: "Get invitation details",
		})
		.input(invitationIdSchema)
		.handler(async ({ input, context }) => {
			return getInvitation(input.invitationId, context.headers);
		}),

	// -------------------------------------------------------------------------
	// Reject Invitation
	// -------------------------------------------------------------------------
	rejectInvitation: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/organizations/invitations/reject`,
			description: "Reject organization invitation",
		})
		.input(invitationIdSchema)
		.handler(async ({ input, context }) => {
			return rejectInvitation(input.invitationId, context.headers);
		}),
};
