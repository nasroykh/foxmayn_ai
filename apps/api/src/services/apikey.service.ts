import { ORPCError } from "@orpc/server";
import { auth } from "../config/auth";
import { getMemberRole } from "./organization.service";
import { getProfile } from "./profile.service";

/**
 * API keys belong to an organization: the organization id is stored in the key
 * metadata at creation, and orgProcedure resolves the organization from it for
 * API-key sessions (re-checking that the key owner is still a member).
 *
 * A key may also be bound to one knowledge base (`profileId` in the metadata).
 * Such a key can only call the chat routes, and only with that profile.
 */

/**
 * Interface for creating an API key (self-service)
 */
export type CreateApiKeyInput = {
	name?: string;
	expiresIn?: number;
	prefix?: string;
	/** Knowledge base (RAG profile of the key owner) the key is limited to. */
	profileId?: string;
};

/**
 * Interface for creating an API key for another user (admin only). Server-side
 * calls may also set remaining and permissions.
 */
export type CreateApiKeyForUserInput = CreateApiKeyInput & {
	userId: string;
	organizationId: string;
	remaining?: number;
	permissions?: Record<string, string[]>;
	metadata?: Record<string, unknown>;
};

/**
 * Interface for updating an API key. Only fields browser clients may change.
 */
export type UpdateApiKeyInput = {
	keyId: string;
	name?: string;
	enabled?: boolean;
};

const assertOwnsProfile = async (userId: string, profileId: string) => {
	if (!(await getProfile(profileId, userId))) {
		throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
	}
};

/** Metadata the key is bound by; never taken from free-form input. */
const scopeMetadata = (organizationId: string, profileId?: string) =>
	profileId ? { organizationId, profileId } : { organizationId };

const assertOrganizationMember = async (
	userId: string,
	organizationId: string,
) => {
	if (!(await getMemberRole(userId, organizationId))) {
		throw new ORPCError("FORBIDDEN", {
			message: "Not a member of this organization",
		});
	}
};

/**
 * Create a new API key for the current user, bound to `organizationId`
 * (their active organization).
 */
export async function createApiKey(
	input: CreateApiKeyInput,
	userId: string,
	organizationId: string,
	headers: Headers,
) {
	await assertOrganizationMember(userId, organizationId);
	const { profileId, ...rest } = input;
	if (profileId) await assertOwnsProfile(userId, profileId);

	return auth.api.createApiKey({
		body: { ...rest, metadata: scopeMetadata(organizationId, profileId) },
		headers,
	});
}

/**
 * Create a new API key for another user (admin only), bound to an organization
 * the user belongs to.
 */
export async function createApiKeyForUser(input: CreateApiKeyForUserInput) {
	await assertOrganizationMember(input.userId, input.organizationId);

	const { organizationId, profileId, metadata, ...rest } = input;
	if (profileId) await assertOwnsProfile(input.userId, profileId);
	// The binding keys are always ours: free-form metadata cannot set them
	const {
		organizationId: _org,
		profileId: _profile,
		...extra
	} = metadata ?? {};
	return auth.api.createApiKey({
		body: {
			...rest,
			metadata: { ...extra, ...scopeMetadata(organizationId, profileId) },
		},
	});
}

/**
 * Get an API key by ID (details only, no secret key)
 */
export async function getApiKey(id: string, headers: Headers) {
	return auth.api.getApiKey({
		query: { id },
		headers,
	});
}

/**
 * Update an existing API key
 */
export async function updateApiKey(input: UpdateApiKeyInput, headers: Headers) {
	return auth.api.updateApiKey({
		body: input,
		headers,
	});
}

/**
 * Delete an API key
 */
export async function deleteApiKey(keyId: string, headers: Headers) {
	return auth.api.deleteApiKey({
		body: { keyId },
		headers,
	});
}

/**
 * List all API keys for the current user
 */
export async function listApiKeys(headers: Headers) {
	return auth.api.listApiKeys({
		headers,
	});
}

/**
 * Delete all expired API keys
 */
export async function deleteAllExpiredApiKeys(headers: Headers) {
	return auth.api.deleteAllExpiredApiKeys({
		headers,
	});
}
