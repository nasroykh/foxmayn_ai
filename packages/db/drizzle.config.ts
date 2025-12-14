import { defineConfig } from "drizzle-kit";
import { env } from "./src/config/env";

if (!env.DB_URL) throw new Error("DB_URL is not set");

export default defineConfig({
	out: "./drizzle",
	schema: "./src/models/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		url: env.DB_URL,
	},
	strict: true,
});
