import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	organization,
	emailOTP,
	admin,
	bearer,
	apiKey,
} from "better-auth/plugins";

import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { eq } from "@repo/db/drizzle-orm";
import { sendOTPEmail, sendInvitationEmail } from "../services/email.service";
import { env } from "./env";

export const auth = betterAuth({
	basePath: `${env.API_V1_PREFIX}/auth`,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	plugins: [
		admin(),
		bearer(),
		apiKey({
			rateLimit: {
				maxRequests: 100,
				timeWindow: 1000 * 60 * 5, // 5 minutes
			},
			enableSessionForAPIKeys: true,
		}),
		organization({
			async sendInvitationEmail(data) {
				const inviteLink = `${env.APP_URL}/invite/${data.id}`;
				sendInvitationEmail(
					data.email,
					data.inviter.user.name,
					data.organization.name,
					inviteLink,
				);
			},
		}),
		emailOTP({
			overrideDefaultEmailVerification: true,
			async sendVerificationOTP({ email, otp }) {
				sendOTPEmail(email, otp);
			},
		}),
	],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes
		},
	},
	trustedOrigins: [env.APP_URL],
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					console.log(`User created: ${user.email}`);

					// Check if user already has an organization (e.g., accepted an invitation)
					const existingMemberships = await db
						.select()
						.from(schema.member)
						.where(eq(schema.member.userId, user.id))
						.limit(1);

					// Only create a default organization if user doesn't belong to any
					if (existingMemberships.length === 0) {
						// Generate organization name from user's name or email
						const orgName = user.name || user.email.split("@")[0];
						const baseSlug = orgName
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-|-$/g, "");
						const slug = `${baseSlug}-${Date.now()}`;

						// Create organization using Better Auth API
						// User will automatically become owner
						await auth.api.createOrganization({
							body: {
								name: orgName,
								slug,
								userId: user.id,
							},
						});

						console.log(`Created default organization for user: ${user.email}`);
					}
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
