import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config as dotenvConfig } from "dotenv";

// Load environment variables
dotenvConfig({ override: true, quiet: true });

// Use DB_URL if available, otherwise construct from individual variables
const connectionString =
	process.env.DB_URL ||
	`postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${
		process.env.DB_HOST
	}:${process.env.DB_PORT}/${process.env.DB_NAME}?sslmode=${
		process.env.DB_SSL_MODE || "disable"
	}`;

const pool = new Pool({
	connectionString,
});

export const db = drizzle(pool);

export async function initDB() {
	try {
		await pool.connect();
		console.log("📦 Database connected successfully");
	} catch (error) {
		console.error("❌ Database connection failed:", error);
		console.error("💡 Make sure PostgreSQL is running and the database exists");
		process.exit(1);
	}
}

export async function disconnectDB() {
	await pool.end();
	console.log("📦 Database disconnected");
}

export * from "./models/schema";
