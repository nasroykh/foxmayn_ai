import { db, ragProfile } from "@repo/db";
import { eq, desc, and } from "@repo/db/drizzle-orm";
import type { RagProfileInsert, RagProfileUpdate } from "@repo/db/types";
import { randomUUID } from "node:crypto";

/**
 * Create a new RAG profile
 */
export const createProfile = async (
	data: Omit<RagProfileInsert, "id" | "createdAt" | "updatedAt">,
) => {
	const id = randomUUID();
	const [newProfile] = await db
		.insert(ragProfile)
		.values({ ...data, id })
		.returning();
	return newProfile;
};

/**
 * Get a RAG profile by ID (scoped to user)
 */
export const getProfile = async (id: string, userId?: string) => {
	const conditions = [eq(ragProfile.id, id)];
	if (userId) conditions.push(eq(ragProfile.userId, userId));

	const [profile] = await db
		.select()
		.from(ragProfile)
		.where(and(...conditions));
	return profile || null;
};

/**
 * Get the default RAG profile for a user
 */
export const getDefaultProfile = async (userId?: string) => {
	const conditions = [eq(ragProfile.isDefault, true)];
	if (userId) conditions.push(eq(ragProfile.userId, userId));

	const [profile] = await db
		.select()
		.from(ragProfile)
		.where(and(...conditions))
		.limit(1);
	return profile || null;
};

/**
 * List all RAG profiles (scoped to user)
 */
export const listProfiles = async (limit = 20, offset = 0, userId?: string) => {
	if (userId) {
		return await db
			.select()
			.from(ragProfile)
			.where(eq(ragProfile.userId, userId))
			.limit(limit)
			.offset(offset)
			.orderBy(desc(ragProfile.createdAt));
	}
	return await db
		.select()
		.from(ragProfile)
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
	userId?: string,
) => {
	const conditions = [eq(ragProfile.id, id)];
	if (userId) conditions.push(eq(ragProfile.userId, userId));

	const [updatedProfile] = await db
		.update(ragProfile)
		.set(data)
		.where(and(...conditions))
		.returning();
	return updatedProfile;
};

/**
 * Delete a RAG profile (scoped to user)
 */
export const deleteProfile = async (id: string, userId?: string) => {
	const conditions = [eq(ragProfile.id, id)];
	if (userId) conditions.push(eq(ragProfile.userId, userId));

	await db.delete(ragProfile).where(and(...conditions));
};
