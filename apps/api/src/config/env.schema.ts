import { createHash } from "node:crypto";
import { z } from "zod";

// SHA-256 of values that an old public .env.example shipped (auth secret,
// admin password). They must never reach production. Hashes, so the leaked
// values are not repeated in the code.
const KNOWN_EXAMPLE_SECRET_HASHES = new Set([
	"e370bb2e7a1dd75db2e35ffc816af7707b2a735f5eb19992b248f3456d68e531",
	"aa3d2fe4f6d301dbd6b8fb2d2fddfb7aeebf3bec53ffff4b39a0967afa88c609",
]);

export const isKnownExampleSecret = (
	value: string,
	hashes: ReadonlySet<string> = KNOWN_EXAMPLE_SECRET_HASHES,
): boolean => hashes.has(createHash("sha256").update(value).digest("hex"));

const PLACEHOLDER_PATTERN = /change[_-]?me/i;

/**
 * Returns the names of env vars that still hold a placeholder or a known
 * example secret.
 */
export const findPlaceholderEnvKeys = (
	values: Record<string, unknown>,
): string[] =>
	Object.entries(values)
		.filter(
			([, value]) =>
				typeof value === "string" &&
				(PLACEHOLDER_PATTERN.test(value) || isKnownExampleSecret(value)),
		)
		.map(([key]) => key);

// PORT, HOST and API_V1_PREFIX have defaults because the worker process
// imports this schema and does not set them.
export const envSchema = z
	.object({
		// Environment
		NODE_ENV: z.enum(["development", "production", "test"]),

		// Server Configuration
		PORT: z.coerce.number().default(33450),
		HOST: z.string().default("0.0.0.0"),
		API_V1_PREFIX: z.string().startsWith("/").default("/api/v1"),

		// Public origin of the app (the API is served on the same origin via proxy)
		APP_URL: z.url(),

		// Better Auth Configuration
		BETTER_AUTH_SECRET: z.string().min(32),

		// Super Admin Configuration
		SUPER_ADMIN_EMAIL: z.email(),
		SUPER_ADMIN_PASSWORD: z.string().min(12),

		// Database Configuration
		DB_URL: z.url(),

		// SMTP Configuration
		SMTP_HOST: z.string().min(1),
		SMTP_PORT: z.coerce.number(),
		SMTP_USER: z.string().min(1),
		SMTP_PASSWORD: z.string().min(1),
		SMTP_FROM: z.string().min(1),

		// Redis Configuration (the URL may carry credentials, e.g. redis://:pass@host:6379)
		REDIS_URL: z.url(),

		// OpenRouter Configuration
		OPENROUTER_API_KEY: z.string().min(1),

		// Qdrant Configuration
		QDRANT_URL: z.url(),
		QDRANT_API_KEY: z
			.string()
			.optional()
			.transform((value) => value || undefined),
		// Used as a collection name prefix
		QDRANT_COLLECTION_NAME: z.string().min(1).default("documents"),

		// Per API key rate limit. Copied into each key at creation: changing it
		// later does not affect existing keys.
		API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
		API_KEY_RATE_LIMIT_WINDOW_SECONDS: z.coerce
			.number()
			.int()
			.positive()
			.default(300),
	})
	.superRefine((values, ctx) => {
		if (values.NODE_ENV !== "production") return;

		for (const key of findPlaceholderEnvKeys(values)) {
			ctx.addIssue({
				code: "custom",
				path: [key],
				message: `${key} still holds a placeholder or example value; set a real value for production`,
			});
		}
	});

export type Env = z.infer<typeof envSchema>;
