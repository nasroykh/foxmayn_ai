import { test } from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth/api";
import { toORPCError } from "./errors";

test("maps APIError to ORPCError keeping status and message", () => {
	const mapped = toORPCError(
		new APIError("UNAUTHORIZED", {
			message: "Invalid email or password",
			code: "INVALID_EMAIL_OR_PASSWORD",
		}),
	);
	assert.ok(mapped instanceof ORPCError);
	assert.equal(mapped.status, 401);
	assert.equal(mapped.code, "UNAUTHORIZED");
	assert.equal(mapped.message, "Invalid email or password");
	assert.deepEqual(mapped.data, { code: "INVALID_EMAIL_OR_PASSWORD" });
});

test("maps numeric status codes", () => {
	const mapped = toORPCError(new APIError(429, { message: "Too many" }));
	assert.ok(mapped instanceof ORPCError);
	assert.equal(mapped.status, 429);
	assert.equal(mapped.code, "TOO_MANY_REQUESTS");
});

test("maps unknown 4xx statuses to BAD_REQUEST code but keeps the status", () => {
	const mapped = toORPCError(new APIError(418, { message: "teapot" }));
	assert.ok(mapped instanceof ORPCError);
	assert.equal(mapped.status, 418);
	assert.equal(mapped.code, "BAD_REQUEST");
});

test("leaves ORPCError and plain errors untouched", () => {
	const orpc = new ORPCError("FORBIDDEN", { message: "no" });
	assert.equal(toORPCError(orpc), orpc);
	const plain = new Error("boom");
	assert.equal(toORPCError(plain), plain);
	assert.equal(toORPCError("string"), "string");
});
