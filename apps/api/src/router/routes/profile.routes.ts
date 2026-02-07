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
import { authProcedure } from "../middleware";
import { env } from "../../config/env";
import { ragProfileInsertSchema, ragProfileUpdateSchema } from "@repo/db/types";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const profileRoutes = {
	createProfile: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/profiles`,
			description: "Create a new RAG profile",
		})
		.input(
			ragProfileInsertSchema.omit({
				id: true,
				userId: true,
				createdAt: true,
				updatedAt: true,
			})
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

	updateProfile: authProcedure
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
					userId: true,
					createdAt: true,
					updatedAt: true,
				}),
			})
		)
		.handler(async ({ input, context }) => {
			const profile = await updateProfile(
				input.id,
				input.data,
				context.user.id
			);
			if (!profile) {
				throw new ORPCError("NOT_FOUND", { message: "Profile not found" });
			}
			return profile;
		}),

	deleteProfile: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/profiles/{id}`,
			description: "Delete a profile",
		})
		.input(z.object({ id: z.string() }))
		.handler(async ({ input, context }) => {
			await deleteProfile(input.id, context.user.id);
			return { message: "Profile deleted" };
		}),
};
