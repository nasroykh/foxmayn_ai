import { test } from "node:test";
import assert from "node:assert/strict";
import { runReadinessChecks } from "./health-checks";

test("reports ready when every check passes", async () => {
	const report = await runReadinessChecks(
		{ postgres: async () => 1, redis: async () => "PONG" },
		500,
	);
	assert.equal(report.status, "ready");
	assert.equal(report.checks.postgres.ok, true);
	assert.equal(report.checks.redis.ok, true);
});

test("reports unavailable without leaking the error", async () => {
	const report = await runReadinessChecks(
		{
			postgres: async () => {
				throw new Error("password authentication failed for user x");
			},
			redis: async () => "PONG",
		},
		500,
	);
	assert.equal(report.status, "unavailable");
	assert.deepEqual(report.checks.postgres.error, "unavailable");
	assert.equal(report.checks.redis.ok, true);
});

test("a hanging check times out", async () => {
	const report = await runReadinessChecks(
		{ redis: () => new Promise(() => {}) },
		20,
	);
	assert.equal(report.status, "unavailable");
	assert.equal(report.checks.redis.ok, false);
});
