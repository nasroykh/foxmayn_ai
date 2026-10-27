import { test } from "node:test";
import assert from "node:assert/strict";
import {
	maskEmail,
	maskEmails,
	redactSecrets,
	errorStatus,
	describeError,
} from "./redact";

test("maskEmail keeps first char and domain", () => {
	assert.equal(maskEmail("jane.doe@example.com"), "j***@example.com");
});

test("maskEmail handles missing and malformed values", () => {
	assert.equal(maskEmail(undefined), "<none>");
	assert.equal(maskEmail("not-an-email"), "***");
	assert.equal(maskEmail("@example.com"), "***");
});

test("maskEmails joins lists", () => {
	assert.equal(maskEmails(["a@x.com", "b@y.com"]), "a***@x.com, b***@y.com");
	assert.equal(maskEmails("a@x.com"), "a***@x.com");
});

test("redactSecrets removes bearer tokens and sk- keys", () => {
	assert.equal(
		redactSecrets("authorization: Bearer sk-or-v1-abc123def456 x"),
		"authorization: Bearer [redacted] x",
	);
	assert.equal(redactSecrets("key sk-or-v1-abcdef123456"), "key [redacted]");
	assert.equal(redactSecrets("nothing here"), "nothing here");
});

test("errorStatus reads statusCode, status and cause", () => {
	assert.equal(errorStatus({ statusCode: 401 }), 401);
	assert.equal(errorStatus({ status: 503 }), 503);
	assert.equal(errorStatus({ cause: { statusCode: 429 } }), 429);
	assert.equal(errorStatus(new Error("x")), undefined);
	assert.equal(errorStatus(null), undefined);
});

test("describeError never includes headers or tokens", () => {
	const err = Object.assign(new Error("User not found. Bearer sk-or-v1-secretsecret"), {
		name: "UnauthorizedResponseError",
		statusCode: 401,
		request: { headers: { authorization: "Bearer sk-or-v1-secretsecret" } },
	});
	const out = describeError(err);
	assert.equal(out, "UnauthorizedResponseError (status 401): User not found. Bearer [redacted]");
	assert.ok(!out.includes("secretsecret"));
	assert.equal(describeError("boom"), "string: boom");
});
