import { z } from "zod";
import "dotenv/config";

// Define the schema for your environment variables
const envSchema = z.object({
	// Redis Configuration
	REDIS_URL: z.url(),

	// Super Admin Configuration
	SUPER_ADMIN_EMAIL: z.email(),
	SUPER_ADMIN_PASSWORD: z.string().min(8),

	// Server Configuration
	PORT: z.coerce.number(),
	HOST: z.string(),
	API_V1_PREFIX: z.string().startsWith("/"),

	// APP Configuration
	APP_URL: z.url(),
	APP_URL_DEV: z.url(),

	TOKEN_SECRET_KEY: z.string(),
	TOKEN_ENCRYPTION_KEY: z.string(),

	// Environment
	NODE_ENV: z.enum(["development", "production", "test"]),
	// Database Configuration
	DB_URL: z.url(),
	DB_USER: z.string(),
	DB_PASSWORD: z.string(),
	DB_HOST: z.string(),
	DB_PORT: z.coerce.number(),
	DB_NAME: z.string(),
	DB_SSL_MODE: z.string(),

	// SMTP Configuration
	SMTP_HOST: z.string(),
	SMTP_PORT: z.coerce.number(),
	SMTP_USER: z.string(),
	SMTP_PASSWORD: z.string(),
	SMTP_FROM: z.string(),

	// Better Auth Configuration
	BETTER_AUTH_SECRET: z.string(),

	// OpenRouter Configuration
	OPENROUTER_API_KEY: z.string(),

	// Qdrant Configuration
	QDRANT_URL: z.url(),
	QDRANT_COLLECTION_NAME: z.string(),
});

// Validate the environment variables and export the result
export const env = envSchema.parse(process.env);

// Export the inferred type for use in other parts of your application
export type Env = z.infer<typeof envSchema>;
