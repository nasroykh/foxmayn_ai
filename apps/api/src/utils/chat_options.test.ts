import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EXCLUDED_SOURCE_PREFIXES, queryOptionsSchema } from "./chat_options";

test("excludeSourcePrefixes accepts up to the maximum", () => {
	const prefixes = Array.from(
		{ length: MAX_EXCLUDED_SOURCE_PREFIXES },
		(_, i) => `https://example.com/${i}/`,
	);
	assert.ok(queryOptionsSchema.safeParse({ excludeSourcePrefixes: prefixes }).success);
	assert.ok(queryOptionsSchema.safeParse({ excludeSourcePrefixes: [] }).success);
	assert.ok(queryOptionsSchema.safeParse({}).success);
});

test("excludeSourcePrefixes rejects more than 8 entries", () => {
	const prefixes = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}/`);
	assert.equal(MAX_EXCLUDED_SOURCE_PREFIXES, 8);
	assert.equal(queryOptionsSchema.safeParse({ excludeSourcePrefixes: prefixes }).success, false);
});

test("excludeSourcePrefixes rejects an empty or over-long prefix", () => {
	assert.equal(queryOptionsSchema.safeParse({ excludeSourcePrefixes: [""] }).success, false);
	assert.equal(
		queryOptionsSchema.safeParse({ excludeSourcePrefixes: ["x".repeat(513)] }).success,
		false,
	);
});
