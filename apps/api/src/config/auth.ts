import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	admin,
	emailOTP,
	organization,
	apiKey,
	bearer,
} from "better-auth/plugins";
import Stripe from "stripe";
import { stripe } from "@better-auth/stripe";

import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { sendOTPEmail, sendInvitationEmail } from "../services/auth.service";
import { env } from "./env";

const stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
	apiVersion: "2026-01-28.clover", // Latest API version as of Stripe SDK v20.1.0
});

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
		stripe({
			subscription: {
				enabled: true,
				plans: [
					{
						name: "Basic Plan",
						priceId: "price_1SabzgDGslX4mtt6sdLs0ABj",
					},
					{
						name: "Pro Plan",
						priceId: "price_1SabzsDGslX4mtt6YZbJKbj8",
					},
					{
						name: "Enterprise Plan",
						priceId: "price_1Sac0GDGslX4mtt6VugQqwTB",
					},
				],
				organization: { enabled: true },
			},
			stripeClient,
			stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
			createCustomerOnSignUp: true,
		}),
	],
	emailAndPassword: {
		enabled: true,
		// requireEmailVerification: true,
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes
		},
	},
	trustedOrigins: [env.APP_URL],
});
