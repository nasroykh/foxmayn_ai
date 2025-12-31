import { auth } from "../config/auth";

// =============================================================================
// Types
// =============================================================================

type Role = "admin" | "user";

export type CreateUserInput = {
	email: string;
	password: string;
	name: string;
	role?: Role | Role[];
	data?: Record<string, unknown>;
};

export type ListUsersInput = {
	searchValue?: string;
	searchField?: "email" | "name";
	searchOperator?: "contains" | "starts_with" | "ends_with";
	limit?: number;
	offset?: number;
	sortBy?: string;
	sortDirection?: "asc" | "desc";
	filterField?: string;
	filterValue?: string | number | boolean;
	filterOperator?: "eq" | "ne" | "lt" | "lte" | "gt" | "gte";
};

export type UpdateUserInput = {
	userId: string;
	data: Record<string, unknown>;
};

export type SetUserRoleInput = {
	userId: string;
	role: Role | Role[];
};

export type SetUserPasswordInput = {
	userId: string;
	newPassword: string;
};

export type BanUserInput = {
	userId: string;
	banReason?: string;
	banExpiresIn?: number;
};

export type UserIdInput = {
	userId: string;
};

export type SessionTokenInput = {
	sessionToken: string;
};

export type LoginUserInput = {
	email: string;
	password: string;
};

export const loginUser = async (input: LoginUserInput, headers: Headers) => {
	return auth.api.signInEmail({
		body: {
			email: input.email,
			password: input.password,
		},
		headers,
	});
};

// =============================================================================
// User CRUD Operations
// =============================================================================

/**
 * Create a new user (Admin only)
 */
export async function createUser(input: CreateUserInput, headers: Headers) {
	return auth.api.createUser({
		body: {
			email: input.email,
			password: input.password,
			name: input.name,
			role: input.role,
			data: input.data,
		},
		headers,
	});
}

/**
 * List all users with pagination and filtering (Admin only)
 */
export async function listUsers(input: ListUsersInput, headers: Headers) {
	return auth.api.listUsers({
		query: {
			searchValue: input.searchValue,
			searchField: input.searchField,
			searchOperator: input.searchOperator,
			limit: input.limit,
			offset: input.offset,
			sortBy: input.sortBy,
			sortDirection: input.sortDirection,
			filterField: input.filterField,
			filterValue: input.filterValue,
			filterOperator: input.filterOperator,
		},
		headers,
	});
}

/**
 * Update a user's details (Admin only)
 */
export async function updateUser(input: UpdateUserInput, headers: Headers) {
	return auth.api.adminUpdateUser({
		body: {
			userId: input.userId,
			data: input.data,
		},
		headers,
	});
}

/**
 * Remove/delete a user (Admin only)
 */
export async function removeUser(userId: string, headers: Headers) {
	return auth.api.removeUser({
		body: { userId },
		headers,
	});
}

// =============================================================================
// Role Management
// =============================================================================

/**
 * Set a user's role (Admin only)
 */
export async function setUserRole(input: SetUserRoleInput, headers: Headers) {
	return auth.api.setRole({
		body: {
			userId: input.userId,
			role: input.role,
		},
		headers,
	});
}

/**
 * Set a user's password (Admin only)
 */
export async function setUserPassword(
	input: SetUserPasswordInput,
	headers: Headers
) {
	return auth.api.setUserPassword({
		body: {
			userId: input.userId,
			newPassword: input.newPassword,
		},
		headers,
	});
}

// =============================================================================
// Ban Management
// =============================================================================

/**
 * Ban a user (Admin only)
 */
export async function banUser(input: BanUserInput, headers: Headers) {
	return auth.api.banUser({
		body: {
			userId: input.userId,
			banReason: input.banReason,
			banExpiresIn: input.banExpiresIn,
		},
		headers,
	});
}

/**
 * Unban a user (Admin only)
 */
export async function unbanUser(userId: string, headers: Headers) {
	return auth.api.unbanUser({
		body: { userId },
		headers,
	});
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * List all sessions for a user (Admin only)
 */
export async function listUserSessions(userId: string, headers: Headers) {
	return auth.api.listUserSessions({
		body: { userId },
		headers,
	});
}

/**
 * Revoke a specific session (Admin only)
 */
export async function revokeUserSession(
	sessionToken: string,
	headers: Headers
) {
	return auth.api.revokeUserSession({
		body: { sessionToken },
		headers,
	});
}

/**
 * Revoke all sessions for a user (Admin only)
 */
export async function revokeUserSessions(userId: string, headers: Headers) {
	return auth.api.revokeUserSessions({
		body: { userId },
		headers,
	});
}

// =============================================================================
// Impersonation
// =============================================================================

/**
 * Impersonate a user (Admin only)
 */
export async function impersonateUser(userId: string, headers: Headers) {
	return auth.api.impersonateUser({
		body: { userId },
		headers,
	});
}

/**
 * Stop impersonating a user
 */
export async function stopImpersonating(headers: Headers) {
	return auth.api.stopImpersonating({
		headers,
	});
}
