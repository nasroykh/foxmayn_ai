/**
 * Worker Entry Point
 *
 * Runs in a separate process from the API server and processes background
 * jobs from the BullMQ queues (document indexing, email).
 *
 * Run with: pnpm dev (tsx watch) or node dist/index.js
 */

import { writeFile } from "node:fs/promises";
import { initDB, disconnectDB } from "@repo/db";
import {
	createDocumentWorker,
	createEmailWorker,
	documentQueue,
	closeQueues,
} from "@repo/api/jobs";

type ManagedWorker = ReturnType<
	typeof createDocumentWorker | typeof createEmailWorker
>;

const workers: ManagedWorker[] = [];

// Docker healthcheck: the file's mtime must be recent (see apps/worker/Dockerfile).
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";
const HEARTBEAT_INTERVAL_MS = 15_000;
const REDIS_CHECK_TIMEOUT_MS = 5_000;

// Must stay below docker-compose `stop_grace_period` (120s) so we exit by ourselves.
const SHUTDOWN_TIMEOUT_MS = 100_000;

let shuttingDown = false;
let heartbeatTimer: NodeJS.Timeout | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Touches the heartbeat file only while every worker runs and Redis answers. */
async function heartbeat() {
	if (shuttingDown) return;
	try {
		if (!workers.every((worker) => worker.isRunning())) {
			throw new Error("a worker is not running");
		}
		// A cheap round trip to Redis; hangs (instead of failing) while Redis is down.
		await withTimeout(documentQueue.getJobCounts(), REDIS_CHECK_TIMEOUT_MS, "Redis check");
		await writeFile(HEARTBEAT_FILE, String(Date.now()));
	} catch (error) {
		console.error("⚠️ Heartbeat skipped:", error instanceof Error ? error.message : error);
	}
}

async function start() {
	console.log("🚀 Starting worker process...");

	try {
		await initDB();
		console.log("✅ Database connected");

		workers.push(createDocumentWorker(), createEmailWorker());

		console.log("✅ All workers started and listening for jobs");
		console.log("   - Document worker (concurrency: 2)");
		console.log("   - Email worker (concurrency: 10)");

		await heartbeat();
		heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
	} catch (error) {
		console.error("❌ Failed to start workers:", error);
		process.exit(1);
	}
}

async function gracefulShutdown(signal: string) {
	// A second signal must not start a second shutdown.
	if (shuttingDown) return;
	shuttingDown = true;
	if (heartbeatTimer) clearInterval(heartbeatTimer);

	console.log(`\n🛑 Received ${signal}. Shutting down workers gracefully...`);

	// Bound the wait for active jobs; unfinished jobs are retried via BullMQ stalled-job recovery.
	const forceExit = setTimeout(() => {
		console.error(`❌ Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	forceExit.unref();

	try {
		// Waits for active jobs to complete
		await Promise.all(workers.map((worker) => worker.close()));
		console.log("✅ All workers stopped");

		await closeQueues();
		console.log("✅ Queue connections closed");

		await disconnectDB();
		console.log("✅ Graceful shutdown complete");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error during shutdown:", error);
		process.exit(1);
	}
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

// State is undefined after an uncaught exception: exit now and let Docker restart us.
process.on("uncaughtException", (error) => {
	console.error("❌ Uncaught exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
	// Don't exit - just log. BullMQ handles job failures internally.
});

void start();
