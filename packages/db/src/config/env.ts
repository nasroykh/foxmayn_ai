import { z } from "zod";
import * as dotenv from "dotenv";

// Load .env file contents into process.env
dotenv.config({ override: true, quiet: true });

// Define the schema for your environment variables
const envSchema = z.object({
	// Database Configuration
	DB_URL: z.url(),
	DB_USER: z.string(),
	DB_PASSWORD: z.string(),
	DB_HOST: z.string(),
	DB_PORT: z.coerce.number(),
	DB_NAME: z.string(),
	DB_SSL_MODE: z.string(),
});

// Validate the environment variables and export the result
export const env = envSchema.parse(process.env);

// Export the inferred type for use in other parts of your application
export type Env = z.infer<typeof envSchema>;
