import { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
	createProfile,
	getProfile,
	listProfiles,
	updateProfile,
	deleteProfile,
	getDefaultProfile,
} from "../../services/profile.service";
import {
	countProfileDocuments,
	reindexProfileDocuments,
} from "../../services/rag.service";
import { getBalance } from "../../services/credits.service";
import { authProcedure, orgProcedure } from "../middleware";
import { env } from "../../config/env";
import { ragProfileInsertSchema, ragProfileUpdateSchema } from "@repo/db/types";
import {
	DEFAULT_CHUNK_OVERLAP,
	DEFAULT_CHUNK_SIZE,
	isValidChunkOverlap,
	profileSettingsShape,
} from "../../utils/profile_schema";

const OVERLAP_MESSAGE = "chunkOverlap must be smaller than chunkSize";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const profileRoutes = {
	createProfile: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/profiles`,
			description: "Create a new RAG profile",
		})
		.input(
			ragProfileInsertSchema
				.omit({
					id: true,
					userId: true,
					createdAt: true,
					updatedAt: true,
				})
				// Bounded settings; `name` stays required
				.extend({
					...profileSettingsShape,
					name: z.string().trim().min(1).max(100),
				})
				.refine(
					(p) =>
						isValidChunkOverlap(
							p.chunkSize ?? DEFAULT_CHUNK_SIZE,
							p.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
						),
					{ message: OVERLAP_MESSAGE, path: ["chunkOverlap"] },
				),
		)
		.handler(async ({ input, context }) => {
			const profile = await createProfile({
				...input,
				userId: context.user.id,
			});
			return profile;
		}),

	listProfiles: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/profiles`,
			description: "List RAG profiles",
		})
		.input(
			z.object({
				offset: z.coerce.number().min(0).optional(),
				limit: z.coerce.number().min(1).max(100).optional(),
			})
		)
		.handler(async ({ input, context }) => {
			const { limit = 20, offset = 0 } = input;
			const profiles = await listProfiles(limit, offset, context.user.id);
			return { profiles };
		}),

	getProfile: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/profiles/{id}`,
			description: "Get a profile by ID",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input, context }) => {
			const profile = await getProfile(input.id, context.user.id);
			if (!profile) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}
			return profile;
		}),

	getDefaultProfile: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/profiles/default`,
			description: "Get the default profile",
		})
		.handler(async ({ context }) => {
			const profile = await getDefaultProfile(context.user.id);
			if (!profile) {
				throw new ORPCError("NOT_FOUND", {
					message: "Default profile not found",
				});
			}
			return profile;
		}),

	updateProfile: orgProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/profiles/{id}`,
			description: "Update a profile",
		})
		.input(
			z.object({
				id: z.string(),
				data: ragProfileUpdateSchema
					.omit({
						id: true,
						userId: true,
						createdAt: true,
						updatedAt: true,
					})
					.extend(profileSettingsShape),
			})
		)
		.handler(async ({ input, context }) => {
			const userId = context.user.id;
			const existing = await getProfile(input.id, userId);
			if (!existing) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}

			// Overlap vs size must hold for the values the profile will end up with
			const { chunkSize, chunkOverlap } = input.data;
			if (
				(chunkSize !== undefined || chunkOverlap !== undefined) &&
				!isValidChunkOverlap(
					chunkSize ?? existing.chunkSize,
					chunkOverlap ?? existing.chunkOverlap,
				)
			) {
				throw new ORPCError("BAD_REQUEST", { message: OVERLAP_MESSAGE });
			}

			// Vectors of different embedding models are not comparable: re-index the
			// profile's documents with the new model (billed to the active organization)
			const modelChanged =
				input.data.embeddingModel !== undefined &&
				input.data.embeddingModel !== existing.embeddingModel;

			// Re-indexing replaces the old index only after credits are reserved. Refuse
			// up front when the organization cannot pay, so the change is not accepted
			// and then fails on every document.
			if (modelChanged) {
				const documentCount = await countProfileDocuments(existing, userId);
				if (documentCount > 0 && (await getBalance(context.organizationId)) <= 0) {
					throw new ORPCError("FORBIDDEN", {
						message:
							"Changing the embedding model re-indexes your documents and needs credits. Top up your organization first.",
					});
				}
			}

			const profile = await updateProfile(input.id, input.data, userId);
			if (!profile) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}

			const { count: reindexingDocuments } = modelChanged
				? await reindexProfileDocuments(profile, userId, context.organizationId)
				: { count: 0 };

			return { ...profile, reindexingDocuments };
		}),

	deleteProfile: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/profiles/{id}`,
			description: "Delete a profile",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input, context }) => {
			const deleted = await deleteProfile(input.id, context.user.id);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}
			return { message: "Profile deleted" };
		}),
};
