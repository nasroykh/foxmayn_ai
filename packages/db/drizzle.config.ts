import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true, quiet: true });

if (!process.env.DB_URL) throw new Error("DB_URL is not set");

export default defineConfig({
	out: "./drizzle",
	schema: "./src/models/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DB_URL,
	},
	strict: true,
});
