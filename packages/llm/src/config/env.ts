import { z } from "zod";
import * as dotenv from "dotenv";
import path from "path";

// Load the root .env. Resolved from this file (src/config or dist/config),
// not from process.cwd(). In containers there is no .env file; dotenv skips it.
dotenv.config({
	path: path.resolve(__dirname, "../../../../.env"),
	quiet: true,
});

// Not validated at import time on purpose: a missing OPENROUTER_API_KEY is
// reported with a clear message on first use (see openrouter.ts getClient()).
const envSchema = z.object({
	APP_URL: z.string().optional(),
	OPENROUTER_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
