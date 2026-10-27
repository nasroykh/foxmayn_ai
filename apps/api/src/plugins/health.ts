import type { Hono } from "hono";
import { db } from "@repo/db";
import { sql } from "@repo/db/drizzle-orm";
import { env } from "../config/env";
import { redis } from "../config/redis";
import { runReadinessChecks } from "./health-checks";

const READINESS_TIMEOUT_MS = 2000;

const pingQdrant = async () => {
	const response = await fetch(`${env.QDRANT_URL}/readyz`, {
		headers: env.QDRANT_API_KEY ? { "api-key": env.QDRANT_API_KEY } : {},
		signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Qdrant answered ${response.status}`);
};

/**
 * Health endpoints. Registered before the other plugins so they are always
 * reachable.
 *
 * - GET /health: liveness. No dependency checks, never fails while the process
 *   can answer. Use it for the container healthcheck.
 * - GET /health/ready: readiness. Pings Postgres, Redis and Qdrant with a short
 *   timeout and answers 503 when one is down.
 */
export const registerHealth = (app: Hono) => {
	app.get("/health", (c) =>
		c.json({
			status: "healthy",
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			environment: env.NODE_ENV,
		}),
	);

	app.get("/health/ready", async (c) => {
		const report = await runReadinessChecks(
			{
				postgres: () => db.execute(sql`select 1`),
				redis: () => redis.ping(),
				qdrant: pingQdrant,
			},
			READINESS_TIMEOUT_MS,
		);

		return c.json(report, report.status === "ready" ? 200 : 503);
	});
};
