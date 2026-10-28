import { db, ragProfile } from "@repo/db";
import { eq, desc, and, ne } from "@repo/db/drizzle-orm";
import { type RagProfileInsert, type RagProfileUpdate } from "@repo/db/types";
import { randomUUID } from "node:crypto";
import { withProfileDefaults } from "../utils/profile_schema";

/**
 * Create a new RAG profile
 */
export const createProfile = async (
	data: Omit<RagProfileInsert, "id" | "createdAt" | "updatedAt">,
) => {
	const id = randomUUID();
	return await db.transaction(async (tx) => {
		// One default per user (unique index): demote the current one first
		if (data.isDefault) {
			await tx
				.update(ragProfile)
				.set({ isDefault: false })
				.where(
					and(eq(ragProfile.userId, data.userId), eq(ragProfile.isDefault, true)),
				);
		}
		const [newProfile] = await tx
			.insert(ragProfile)
			.values({ ...withProfileDefaults(data), id })
			.returning();
		return newProfile;
	});
};

/**
 * Get a RAG profile by ID (scoped to user)
 */
export const getProfile = async (id: string, userId: string) => {
	const [profile] = await db
		.select()
		.from(ragProfile)
		.where(and(eq(ragProfile.id, id), eq(ragProfile.userId, userId)));
	return profile || null;
};

/**
 * Get the default RAG profile for a user
 */
export const getDefaultProfile = async (userId: string) => {
	const [profile] = await db
		.select()
		.from(ragProfile)
		.where(and(eq(ragProfile.isDefault, true), eq(ragProfile.userId, userId)))
		.limit(1);
	return profile || null;
};

/**
 * List RAG profiles (scoped to user)
 */
export const listProfiles = async (
	limit: number,
	offset: number,
	userId: string,
) => {
	return await db
		.select()
		.from(ragProfile)
		.where(eq(ragProfile.userId, userId))
		.limit(limit)
		.offset(offset)
		.orderBy(desc(ragProfile.createdAt));
};

/**
 * Update a RAG profile (scoped to user)
 */
export const updateProfile = async (
	id: string,
	data: Partial<RagProfileUpdate>,
	userId: string,
) => {
	return await db.transaction(async (tx) => {
		if (data.isDefault) {
			// Never demote the current default when the target does not exist
			const [target] = await tx
				.select({ id: ragProfile.id })
				.from(ragProfile)
				.where(and(eq(ragProfile.id, id), eq(ragProfile.userId, userId)));
			if (!target) return undefined;

			await tx
				.update(ragProfile)
				.set({ isDefault: false })
				.where(
					and(
						eq(ragProfile.userId, userId),
						eq(ragProfile.isDefault, true),
						ne(ragProfile.id, id),
					),
				);
		}
		const [updatedProfile] = await tx
			.update(ragProfile)
			.set(data)
			.where(and(eq(ragProfile.id, id), eq(ragProfile.userId, userId)))
			.returning();
		return updatedProfile;
	});
};

/**
 * Delete a RAG profile (scoped to user).
 * Documents and conversations that used it keep existing (profile_id is set to null).
 *
 * @returns true when a profile was deleted, false when none matched
 */
export const deleteProfile = async (id: string, userId: string) => {
	const deleted = await db
		.delete(ragProfile)
		.where(and(eq(ragProfile.id, id), eq(ragProfile.userId, userId)))
		.returning({ id: ragProfile.id });
	return deleted.length > 0;
};
