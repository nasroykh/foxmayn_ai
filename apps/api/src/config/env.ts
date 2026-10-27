import dotenv from "dotenv";
import path from "path";
import { envSchema } from "./env.schema";

// Load root .env (two levels up from apps/api/)
dotenv.config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

// Validate the environment variables and export the result
export const env = envSchema.parse(process.env);

export type { Env } from "./env.schema";
