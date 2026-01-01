import { z } from "zod";
import { ORPCError } from "@orpc/server";

import { adminProcedure, authProcedure, publicProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	createUser,
	listUsers,
	updateUser,
	removeUser,
	setUserRole,
	setUserPassword,
	banUser,
	unbanUser,
	listUserSessions,
	revokeUserSession,
	revokeUserSessions,
	impersonateUser,
	stopImpersonating,
	loginUser,
} from "../../services/user.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// =============================================================================
// Schemas
// =============================================================================

const roleSchema = z.enum(["admin", "user"]);

const createUserSchema = z.object({
	email: z.email(),
	password: z.string().min(8),
	name: z.string().min(1),
	role: roleSchema.or(z.array(roleSchema)).optional(),
	data: z.record(z.string(), z.unknown()).optional(),
});

const listUsersSchema = z.object({
	searchValue: z.string().optional(),
	searchField: z.enum(["email", "name"]).optional(),
	searchOperator: z.enum(["contains", "starts_with", "ends_with"]).optional(),
	limit: z.coerce.number().min(1).max(100).optional(),
	offset: z.coerce.number().min(0).optional(),
	sortBy: z.string().optional(),
	sortDirection: z.enum(["asc", "desc"]).optional(),
	filterField: z.string().optional(),
	filterValue: z.string().or(z.number()).or(z.boolean()).optional(),
	filterOperator: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]).optional(),
});

const updateUserSchema = z.object({
	userId: z.string(),
	data: z.record(z.string(), z.unknown()),
});

const setUserRoleSchema = z.object({
	userId: z.string(),
	role: roleSchema.or(z.array(roleSchema)),
});

const setUserPasswordSchema = z.object({
	userId: z.string(),
	newPassword: z.string().min(8),
});

const banUserSchema = z.object({
	userId: z.string(),
	banReason: z.string().optional(),
	banExpiresIn: z.number().optional(),
});

const userIdSchema = z.object({
	userId: z.string(),
});

const sessionTokenSchema = z.object({
	sessionToken: z.string(),
});

// =============================================================================
// User CRUD Routes
// =============================================================================

export const userRoutes = {
	loginUser: publicProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/auth/login`,
			description: "Login a user",
		})
		.input(
			z.object({
				email: z.email(),
				password: z.string().min(8),
			})
		)
		.handler(async ({ input, context }) => {
			const user = await loginUser(input, context.headers);
			return user;
		}),

	me: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/auth/me`,
			description: "Get the current user",
		})
		.handler(async ({ context }) => {
			if (!context.user)
				throw new ORPCError("UNAUTHORIZED", {
					message: "User not authenticated",
				});

			return context.user;
		}),

	// -------------------------------------------------------------------------
	// Create User
	// -------------------------------------------------------------------------
	createUser: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/users`,
			description: "Create a new user (Admin only)",
		})
		.input(createUserSchema)
		.handler(async ({ input, context }) => {
			const user = await createUser(input, context.headers);
			return user;
		}),

	// -------------------------------------------------------------------------
	// List Users
	// -------------------------------------------------------------------------
	listUsers: adminProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/admin/users`,
			description: "List all users with pagination and filtering (Admin only)",
		})
		.input(listUsersSchema)
		.handler(async ({ input, context }) => {
			const result = await listUsers(input, context.headers);
			return result;
		}),

	// -------------------------------------------------------------------------
	// Get User by ID
	// -------------------------------------------------------------------------
	getUser: adminProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/admin/users/{userId}`,
			description: "Get a specific user by ID (Admin only)",
		})
		.input(userIdSchema)
		.handler(async ({ input, context }) => {
			const result = await listUsers(
				{
					filterField: "id",
					filterValue: input.userId,
					filterOperator: "eq",
					limit: 1,
				},
				context.headers
			);

			if (!result.users || result.users.length === 0) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			return result.users[0];
		}),

	// -------------------------------------------------------------------------
	// Update User
	// -------------------------------------------------------------------------
	updateUser: adminProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/admin/users/{userId}`,
			description: "Update a user's details (Admin only)",
		})
		.input(updateUserSchema)
		.handler(async ({ input, context }) => {
			const user = await updateUser(input, context.headers);
			return user;
		}),

	// -------------------------------------------------------------------------
	// Delete User
	// -------------------------------------------------------------------------
	deleteUser: adminProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/admin/users/{userId}`,
			description: "Delete a user (Admin only)",
		})
		.input(userIdSchema)
		.handler(async ({ input, context }) => {
			await removeUser(input.userId, context.headers);
			return { message: "User deleted successfully" };
		}),

	// -------------------------------------------------------------------------
	// Set User Role
	// -------------------------------------------------------------------------
	setUserRole: adminProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/admin/users/{userId}/role`,
			description: "Set a user's role (Admin only)",
		})
		.input(setUserRoleSchema)
		.handler(async ({ input, context }) => {
			const result = await setUserRole(input, context.headers);
			return result;
		}),

	// -------------------------------------------------------------------------
	// Set User Password
	// -------------------------------------------------------------------------
	setUserPassword: adminProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/admin/users/{userId}/password`,
			description: "Set a user's password (Admin only)",
		})
		.input(setUserPasswordSchema)
		.handler(async ({ input, context }) => {
			const result = await setUserPassword(input, context.headers);
			return result;
		}),

	// -------------------------------------------------------------------------
	// Ban User
	// -------------------------------------------------------------------------
	banUser: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/users/{userId}/ban`,
			description: "Ban a user (Admin only)",
		})
		.input(banUserSchema)
		.handler(async ({ input, context }) => {
			await banUser(input, context.headers);
			return { message: "User banned successfully" };
		}),

	// -------------------------------------------------------------------------
	// Unban User
	// -------------------------------------------------------------------------
	unbanUser: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/users/{userId}/unban`,
			description: "Unban a user (Admin only)",
		})
		.input(userIdSchema)
		.handler(async ({ input, context }) => {
			await unbanUser(input.userId, context.headers);
			return { message: "User unbanned successfully" };
		}),

	// -------------------------------------------------------------------------
	// List User Sessions
	// -------------------------------------------------------------------------
	listUserSessions: adminProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/admin/users/{userId}/sessions`,
			description: "List all sessions for a user (Admin only)",
		})
		.input(userIdSchema)
		.handler(async ({ input, context }) => {
			const sessions = await listUserSessions(input.userId, context.headers);
			return sessions;
		}),

	// -------------------------------------------------------------------------
	// Revoke User Session
	// -------------------------------------------------------------------------
	revokeSession: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/sessions/revoke`,
			description: "Revoke a specific session (Admin only)",
		})
		.input(sessionTokenSchema)
		.handler(async ({ input, context }) => {
			await revokeUserSession(input.sessionToken, context.headers);
			return { message: "Session revoked successfully" };
		}),

	// -------------------------------------------------------------------------
	// Revoke All User Sessions
	// -------------------------------------------------------------------------
	revokeAllUserSessions: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/users/{userId}/sessions/revoke-all`,
			description: "Revoke all sessions for a user (Admin only)",
		})
		.input(userIdSchema)
		.handler(async ({ input, context }) => {
			await revokeUserSessions(input.userId, context.headers);
			return { message: "All sessions revoked successfully" };
		}),

	// -------------------------------------------------------------------------
	// Impersonate User
	// -------------------------------------------------------------------------
	impersonateUser: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/users/{userId}/impersonate`,
			description: "Impersonate a user (Admin only)",
		})
		.input(userIdSchema)
		.handler(async ({ input, context }) => {
			const result = await impersonateUser(input.userId, context.headers);
			return result;
		}),

	// -------------------------------------------------------------------------
	// Stop Impersonating
	// -------------------------------------------------------------------------
	stopImpersonating: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/impersonation/stop`,
			description: "Stop impersonating a user",
		})
		.handler(async ({ context }) => {
			await stopImpersonating(context.headers);
			return { message: "Stopped impersonating" };
		}),
};
