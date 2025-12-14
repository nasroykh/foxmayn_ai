import { z } from "zod";

// Define the schema for your environment variables
const envSchema = z.object({
	VITE_IS_DEV: z.coerce.boolean(),
	VITE_API_URL: z.url(),
	VITE_API_URL_DEV: z.url(),
});

// Validate the environment variables and export the result
export const env = envSchema.parse(import.meta.env);

// Export the inferred type for use in other parts of your application
export type Env = z.infer<typeof envSchema>;
