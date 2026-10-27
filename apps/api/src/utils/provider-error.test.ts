import { test } from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/server";
import { isPermanentProviderError, toChatProviderError } from "./provider-error";

test("permanent provider statuses", () => {
	for (const s of [400, 401, 402, 403, 404]) {
		assert.equal(isPermanentProviderError({ statusCode: s }), true, String(s));
	}
	for (const s of [408, 429, 500, 502, 503]) {
		assert.equal(isPermanentProviderError({ statusCode: s }), false, String(s));
	}
	assert.equal(isPermanentProviderError(new Error("ECONNRESET")), false);
});

test("toChatProviderError maps provider failures without details", () => {
	const rejected = toChatProviderError({ statusCode: 401, message: "sk-or-secret" });
	assert.equal(rejected.code, "BAD_GATEWAY");
	assert.ok(!rejected.message.includes("secret"));
	for (const e of [{ statusCode: 429 }, { statusCode: 503 }, new Error("fetch failed")]) {
		assert.equal(toChatProviderError(e).code, "SERVICE_UNAVAILABLE");
	}
	const own = new ORPCError("BAD_REQUEST", { message: "x" });
	assert.equal(toChatProviderError(own), own);
});
