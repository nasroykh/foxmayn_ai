import { db, ragProfile } from "@repo/db";
import { eq, desc } from "@repo/db/drizzle-orm";
import { RagProfileInsert, RagProfileUpdate } from "@repo/db/types";
import { randomUUID } from "node:crypto";

/**
 * Create a new RAG profile
 */
export const createProfile = async (
	data: Omit<RagProfileInsert, "id" | "createdAt" | "updatedAt">
) => {
	const id = randomUUID();
	const [newProfile] = await db
		.insert(ragProfile)
		.values({ ...data, id })
		.returning();
	return newProfile;
};

/**
 * Get a RAG profile by ID
 */
export const getProfile = async (id: string) => {
	const [profile] = await db
		.select()
		.from(ragProfile)
		.where(eq(ragProfile.id, id));
	return profile || null;
};

/**
 * Get the default RAG profile
 */
export const getDefaultProfile = async () => {
	const [profile] = await db
		.select()
		.from(ragProfile)
		.where(eq(ragProfile.isDefault, true))
		.limit(1);
	return profile || null;
};

/**
 * List all RAG profiles
 */
export const listProfiles = async (limit = 20, offset = 0) => {
	return await db
		.select()
		.from(ragProfile)
		.limit(limit)
		.offset(offset)
		.orderBy(desc(ragProfile.createdAt));
};

/**
 * Update a RAG profile
 */
export const updateProfile = async (id: string, data: RagProfileUpdate) => {
	const [updatedProfile] = await db
		.update(ragProfile)
		.set(data)
		.where(eq(ragProfile.id, id))
		.returning();
	return updatedProfile;
};

/**
 * Delete a RAG profile
 */
export const deleteProfile = async (id: string) => {
	await db.delete(ragProfile).where(eq(ragProfile.id, id));
};
