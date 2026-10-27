import { Hono } from "hono";

import { auth } from "../config/auth";
import { env } from "../config/env";
import { db, user } from "@repo/db";
import { hasAdminRole } from "../router/access";
import { rejectApiKeyHeader } from "./api-key-guard";
import { eq } from "@repo/db/drizzle-orm";

export const registerAuth = (app: Hono) => {
	// API keys work on oRPC routes only (see api-key-guard.ts)
	app.use(`/auth/*`, rejectApiKeyHeader);
	app.on(["POST", "GET"], `/auth/*`, (c) => {
		return auth.handler(c.req.raw);
	});
};

/**
 * Create the super admin account when it does not exist. Idempotent and safe
 * to run on every start and on every replica.
 *
 * An existing account with SUPER_ADMIN_EMAIL is never modified: promoting it
 * would hand admin rights to whoever registered that address first.
 */
export const initSuperAdmin = async () => {
	try {
		const [existing] = await db
			.select({
				id: user.id,
				emailVerified: user.emailVerified,
				role: user.role,
			})
			.from(user)
			.where(eq(user.email, env.SUPER_ADMIN_EMAIL))
			.limit(1);

		if (existing) {
			if (!existing.emailVerified || !hasAdminRole(existing.role)) {
				console.warn(
					"SUPER_ADMIN_EMAIL belongs to an account that is not a verified admin. " +
						"It was left unchanged. Remove or promote that account manually.",
				);
			}
			return;
		}

		const created = await auth.api.createUser({
			body: {
				email: env.SUPER_ADMIN_EMAIL,
				password: env.SUPER_ADMIN_PASSWORD,
				name: "Super Admin",
				role: "admin",
			},
		});

		await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.id, created.user.id));

		console.log("Super admin initialized successfully");
	} catch (error) {
		// Another replica may have created it between the check and the insert
		const [created] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, env.SUPER_ADMIN_EMAIL))
			.limit(1)
			.catch(() => []);
		if (created) return;

		console.error("Failed to initialize super admin:", error);
	}
};
