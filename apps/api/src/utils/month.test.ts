import { test } from "node:test";
import assert from "node:assert/strict";
import { startOfUtcMonth } from "./month";

test("startOfUtcMonth: mid-month goes back to the 1st at 00:00 UTC", () => {
	assert.equal(
		startOfUtcMonth(new Date("2026-03-17T13:45:10.123Z")).toISOString(),
		"2026-03-01T00:00:00.000Z",
	);
});

test("startOfUtcMonth: first instant of a month maps to itself", () => {
	assert.equal(
		startOfUtcMonth(new Date("2026-03-01T00:00:00.000Z")).toISOString(),
		"2026-03-01T00:00:00.000Z",
	);
});

test("startOfUtcMonth: last millisecond of a month stays in that month", () => {
	assert.equal(
		startOfUtcMonth(new Date("2026-02-28T23:59:59.999Z")).toISOString(),
		"2026-02-01T00:00:00.000Z",
	);
});

test("startOfUtcMonth: year rollover", () => {
	assert.equal(
		startOfUtcMonth(new Date("2026-01-01T00:00:00.000Z")).toISOString(),
		"2026-01-01T00:00:00.000Z",
	);
	assert.equal(
		startOfUtcMonth(new Date("2025-12-31T23:59:59.999Z")).toISOString(),
		"2025-12-01T00:00:00.000Z",
	);
});

test("startOfUtcMonth: uses UTC fields, not the offset in the input string", () => {
	// 2026-04-01 01:30 at +05:00 is still 2026-03-31 20:30 UTC
	assert.equal(
		startOfUtcMonth(new Date("2026-04-01T01:30:00+05:00")).toISOString(),
		"2026-03-01T00:00:00.000Z",
	);
	// 2026-03-31 23:30 at -05:00 is already 2026-04-01 04:30 UTC
	assert.equal(
		startOfUtcMonth(new Date("2026-03-31T23:30:00-05:00")).toISOString(),
		"2026-04-01T00:00:00.000Z",
	);
});
