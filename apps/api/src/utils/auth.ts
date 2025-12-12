// packages/auth/src/server.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, organization } from "better-auth/plugins";
import Stripe from "stripe";
import { stripe } from "@better-auth/stripe";

import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { sendOTPEmail, sendInvitationEmail } from "../services/auth.service";

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
	apiVersion: "2025-11-17.clover", // Latest API version as of Stripe SDK v20.0.0
});

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	plugins: [
		admin(),
		organization({
			async sendInvitationEmail(data) {
				const inviteLink = `${process.env.APP_URL}/invite/${data.id}`;
				sendInvitationEmail(
					data.email,
					data.inviter.user.name,
					data.organization.name,
					inviteLink
				);
			},
		}),
		emailOTP({
			overrideDefaultEmailVerification: true,
			async sendVerificationOTP({ email, otp }) {
				sendOTPEmail(email, otp);
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
			stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
			createCustomerOnSignUp: true,
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
	trustedOrigins: [process.env.APP_URL!],
});
