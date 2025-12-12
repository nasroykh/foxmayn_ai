import { createAuthClient } from "better-auth/react";
import {
	emailOTPClient,
	organizationClient,
	adminClient,
} from "better-auth/client/plugins";
import { stripeClient } from "@better-auth/stripe/client";

export const authClient = createAuthClient({
	/** The base URL of the server (optional if you're using the same domain) */
	baseURL: `${import.meta.env.VITE_API_URL}/auth`,
	plugins: [
		adminClient(),
		organizationClient(),
		emailOTPClient(),
		stripeClient({
			subscription: true,
		}),
	],
});
