import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	admin,
	emailOTP,
	organization,
	bearer,
} from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { eq } from "@repo/db/drizzle-orm";
import { sendOTPEmail, sendInvitationEmail } from "../services/email.service";
import { env } from "./env";
import { API_KEY_HEADER } from "./constants";
import { maskEmail } from "./redact";
import { redis } from "./redis";
import { createRedisRateLimitStorage } from "./rate-limit-storage";

export const auth = betterAuth({
	// The API is served on the app origin (reverse proxy), so links built by
	// better-auth (verification, callbacks) resolve through the proxy path
	baseURL: env.APP_URL,
	basePath: `${env.API_V1_PREFIX}/auth`,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	plugins: [
		admin(),
		bearer(),
		apiKey({
			rateLimit: {
				maxRequests: env.API_KEY_RATE_LIMIT_MAX,
				timeWindow: env.API_KEY_RATE_LIMIT_WINDOW_SECONDS * 1000,
			},
			enableSessionForAPIKeys: true,
			apiKeyHeaders: API_KEY_HEADER,
			// Used to bind a key to an organization (metadata.organizationId)
			enableMetadata: true,
		}),
		organization({
			async sendInvitationEmail(data) {
				const inviteLink = `${env.APP_URL}/invite/${data.id}`;
				await sendInvitationEmail(
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
				await sendOTPEmail(email, otp);
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
			// Kept short: a banned user or a revoked session stays valid in the
			// cookie cache until it expires
			maxAge: 60,
		},
	},
	// Shared across API instances and restarts (the default is per-process memory)
	rateLimit: {
		customStorage: createRedisRateLimitStorage(redis),
	},
	advanced: {
		ipAddress: {
			// Caddy (apps/app/Caddyfile) overwrites X-Real-IP with the client IP it
			// resolved from trusted proxies. X-Forwarded-For and cf-connecting-ip are
			// spoofable or multi-valued here. Without Caddy (local dev) the header is
			// absent: better-auth uses 127.0.0.1 in development and no IP in production.
			ipAddressHeaders: ["x-real-ip"],
		},
	},
	trustedOrigins: [env.APP_URL],
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					console.log(`User created: ${maskEmail(user.email)}`);

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

						console.log(
							`Created default organization for user: ${maskEmail(user.email)}`,
						);
					}
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
