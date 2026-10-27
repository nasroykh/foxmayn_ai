import { z } from "zod";
import * as dotenv from "dotenv";
import path from "path";

// Load the root .env. Resolved from this file (src/config or dist/config),
// not from process.cwd(), so it works from any working directory.
// In containers there is no .env file; dotenv silently skips it.
dotenv.config({
	path: path.resolve(__dirname, "../../../../.env"),
	quiet: true,
});

const envSchema = z.object({
	DB_URL: z.string().min(1, "DB_URL is required"),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
