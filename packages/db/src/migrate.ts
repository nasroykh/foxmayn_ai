/**
 * Applies the committed SQL migrations in packages/db/drizzle.
 *
 * Runs as a one-shot container (`migrate` service in docker-compose.yml) and
 * locally via `pnpm db:migrate`. Uses drizzle-orm's runtime migrator, so
 * drizzle-kit is not needed in production images.
 *
 * A session-level Postgres advisory lock serialises concurrent runs.
 */
import path from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { env } from "./config/env";

// Arbitrary constant, unique to this app ("fxai" as an int).
const MIGRATION_LOCK_ID = 0x66786169;

// src/ and dist/ both sit one level below the package root.
const migrationsFolder = path.resolve(__dirname, "../drizzle");

async function main() {
	// One dedicated connection: the advisory lock is held by the session.
	const pool = new Pool({
		connectionString: env.DB_URL,
		max: 1,
		connectionTimeoutMillis: 10_000,
	});
	pool.on("error", (error) => {
		console.error("[migrate] idle client error:", error);
	});

	try {
		const client = await pool.connect();
		try {
			await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
			console.log(`[migrate] applying migrations from ${migrationsFolder}`);
			await migrate(drizzle(client), { migrationsFolder });
			console.log("[migrate] done");
		} finally {
			await client
				.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
				.catch(() => undefined);
			client.release();
		}
	} finally {
		await pool.end();
	}
}

main().catch((error) => {
	console.error("[migrate] failed:", error);
	process.exit(1);
});
