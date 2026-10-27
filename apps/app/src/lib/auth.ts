import { createAuthClient } from "better-auth/react";
import {
	emailOTPClient,
	organizationClient,
	adminClient,
} from "better-auth/client/plugins";
import { API_URL } from "./api-url";

export const authClient = createAuthClient({
	// Matches `basePath` in the API's better-auth config (`<prefix>/auth`).
	baseURL: `${API_URL}/auth`,
	plugins: [adminClient(), organizationClient(), emailOTPClient()],
});

export type User = typeof authClient.$Infer.Session.user;
export type Session = typeof authClient.$Infer.Session;
export type SessionData = Session | null;

export const { useSession, signIn, signUp, signOut, getSession } = authClient;
