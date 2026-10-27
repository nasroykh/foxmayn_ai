import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "./config/env";

const pool = new Pool({
	connectionString: env.DB_URL,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
});

// Without a listener, an error on an idle client (Postgres restart, network
// drop) is an unhandled 'error' event and kills the process.
pool.on("error", (error) => {
	console.error("❌ Unexpected PostgreSQL pool error:", error);
});

export const db = drizzle(pool);

export async function initDB() {
	try {
		const client = await pool.connect();
		client.release();
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
export * from "./models/types";
