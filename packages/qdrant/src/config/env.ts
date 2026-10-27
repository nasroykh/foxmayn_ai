import { z } from "zod";
import * as dotenv from "dotenv";
import path from "path";

// Load the root .env. Resolved from this file (src/config or dist/config),
// not from process.cwd(). In containers there is no .env file; dotenv skips it.
dotenv.config({
	path: path.resolve(__dirname, "../../../../.env"),
	quiet: true,
});

const envSchema = z.object({
	QDRANT_URL: z.url(),
	// Optional: required only when the Qdrant server enforces an API key
	// (always the case in docker-compose.yml).
	QDRANT_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
