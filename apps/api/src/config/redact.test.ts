import { test } from "node:test";
import assert from "node:assert/strict";
import { maskEmail, maskEmails } from "./redact";

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
