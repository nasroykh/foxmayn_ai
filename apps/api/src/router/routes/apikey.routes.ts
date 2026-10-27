import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { adminProcedure, sessionProcedure } from "../middleware";
import {
	createApiKey,
	createApiKeyForUser,
	getApiKey,
	updateApiKey,
	deleteApiKey,
	listApiKeys,
	deleteAllExpiredApiKeys,
} from "../../services/apikey.service";
import { env } from "../../config/env";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

/**
 * API Key Routes
 * These routes allow users to manage their personal API keys. A key is bound
 * to an organization (the creator's active organization) and calls made with
 * it run against that organization. Keys cannot manage keys.
 */
export const apiKeyRoutes = {
	createApiKeyForUser: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/admin/api-keys`,
			description: "Create a new API key for a user",
		})
		.input(
			z.object({
				userId: z.string().min(1).describe("User ID for the API key"),
				organizationId: z
					.string()
					.min(1)
					.describe("Organization the key is bound to (the user must be a member)"),
				profileId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Limit the key to chat with this knowledge base of the user (RAG profile). Such a key cannot call any other endpoint.",
					),
				name: z
					.string()
					.optional()
					.describe("A descriptive name for the API key"),
				expiresIn: z.number().optional().describe("Expiration time in seconds"),
				prefix: z
					.string()
					.optional()
					.describe("Custom prefix for the generated key"),
				remaining: z
					.number()
					.optional()
					.describe("Initial number of remaining requests"),
				permissions: z
					.record(z.string(), z.array(z.string()))
					.optional()
					.describe("Permissions for the API key"),
				metadata: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Additional metadata"),
			})
		)
		.handler(async ({ input }) => {
			return await createApiKeyForUser(input);
		}),

	/**
	 * Create a new API key
	 */
	createApiKey: sessionProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/api-keys`,
			description:
				"Create a new API key for the current user, bound to their active organization",
		})
		.input(
			z.object({
				name: z
					.string()
					.optional()
					.describe("A descriptive name for the API key"),
				expiresIn: z.number().optional().describe("Expiration time in seconds"),
				prefix: z
					.string()
					.optional()
					.describe("Custom prefix for the generated key"),
				profileId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Limit the key to chat with this knowledge base (RAG profile). Such a key cannot call any other endpoint.",
					),
			})
		)
		.handler(async ({ input, context }) => {
			const organizationId = context.session.activeOrganizationId;
			if (!organizationId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "No active organization. Set an active organization first.",
				});
			}

			return await createApiKey(
				input,
				context.user.id,
				organizationId,
				context.headers,
			);
		}),

	/**
	 * List all API keys
	 */
	listApiKeys: sessionProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/api-keys`,
			description: "List all API keys for the current user",
		})
		.handler(async ({ context }) => {
			return await listApiKeys(context.headers);
		}),

	/**
	 * Get API key details
	 */
	getApiKey: sessionProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/api-keys/{id}`,
			description: "Get API key details (without the full secret key)",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input, context }) => {
			return await getApiKey(input.id, context.headers);
		}),

	/**
	 * Update an API key
	 */
	updateApiKey: sessionProcedure
		.route({
			method: "PATCH",
			path: `${PREFIX}/api-keys/{keyId}`,
			description: "Update an API key",
		})
		.input(
			z.object({
				keyId: z.string(),
				name: z.string().optional().describe("Update the name of the key"),
				enabled: z.boolean().optional().describe("Enable or disable the key"),
			})
		)
		.handler(async ({ input, context }) => {
			return await updateApiKey(input, context.headers);
		}),

	/**
	 * Delete an API key
	 */
	deleteApiKey: sessionProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/api-keys/{keyId}`,
			description: "Delete an API key",
		})
		.input(z.object({ keyId: z.string() }))
		.handler(async ({ input, context }) => {
			return await deleteApiKey(input.keyId, context.headers);
		}),

	/**
	 * Clear all expired API keys
	 */
	deleteAllExpiredApiKeys: sessionProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/api-keys/clear-expired`,
			description: "Delete all expired API keys for the current user",
		})
		.handler(async ({ context }) => {
			return await deleteAllExpiredApiKeys(context.headers);
		}),
};
