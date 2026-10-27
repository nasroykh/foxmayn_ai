import * as z from "zod";

/** better-auth's default minimum (the API config does not override it). */
export const MIN_PASSWORD_LENGTH = 8;
/** Matches better-auth's default maximum. */
export const MAX_PASSWORD_LENGTH = 128;

export const newPasswordSchema = z
	.string()
	.min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
	.max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);

export function errorMessage(err: unknown, fallback: string): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return fallback;
}
