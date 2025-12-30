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
import { publicProcedure } from "../middleware";
import { env } from "../../config/env";
import { ragProfileInsertSchema, ragProfileUpdateSchema } from "@repo/db/types";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const profileRoutes = {
	createProfile: publicProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/profiles`,
			description: "Create a new RAG profile",
		})
		.input(
			ragProfileInsertSchema.omit({
				id: true,
				createdAt: true,
				updatedAt: true,
			})
		)
		.handler(async ({ input }) => {
			const profile = await createProfile(input as any);
			return profile;
		}),

	listProfiles: publicProcedure
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
		.handler(async ({ input }) => {
			const { limit = 20, offset = 0 } = input;
			const profiles = await listProfiles(limit, offset);
			return { profiles };
		}),

	getProfile: publicProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/profiles/{id}`,
			description: "Get a profile by ID",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const profile = await getProfile(input.id);
			if (!profile) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}
			return profile;
		}),

	getDefaultProfile: publicProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/profiles/default`,
			description: "Get the default profile",
		})
		.handler(async () => {
			const profile = await getDefaultProfile();
			if (!profile) {
				throw new ORPCError("NOT_FOUND", {
					message: "Default profile not found",
				});
			}
			return profile;
		}),

	updateProfile: publicProcedure
		.route({
			method: "PUT",
			path: `${PREFIX}/profiles/{id}`,
			description: "Update a profile",
		})
		.input(
			z.object({
				id: z.string(),
				data: ragProfileUpdateSchema.omit({
					id: true,
					createdAt: true,
					updatedAt: true,
				}),
			})
		)
		.handler(async ({ input }) => {
			const profile = await updateProfile(input.id, input.data as any);
			if (!profile) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}
			return profile;
		}),

	deleteProfile: publicProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/profiles/{id}`,
			description: "Delete a profile",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			await deleteProfile(input.id);
			return { message: "Profile deleted" };
		}),
};
