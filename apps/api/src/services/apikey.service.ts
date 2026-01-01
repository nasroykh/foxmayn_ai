import { auth } from "../config/auth";

/**
 * Interface for creating an API key
 */
export type CreateApiKeyInput = {
	name?: string;
	expiresIn?: number;
	prefix?: string;
	remaining?: number;
	permissions?: Record<string, string[]>;
	metadata?: any;
	userId?: string;
};

/**
 * Interface for updating an API key
 */
export type UpdateApiKeyInput = {
	keyId: string;
	name?: string;
	enabled?: boolean;
	remaining?: number;
	refillAmount?: number;
	refillInterval?: number;
	permissions?: Record<string, string[]>;
	metadata?: any;
	userId?: string;
};

/**
 * Create a new API key
 */
export async function createApiKey(
	input: CreateApiKeyInput,
	headers?: Headers
) {
	return auth.api.createApiKey({
		body: input,
		headers,
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
