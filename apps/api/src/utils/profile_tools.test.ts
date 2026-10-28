import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	checkToolCall,
	enabledTools,
	MAX_PROFILE_TOOLS,
	parametersSchemaError,
	profileToolsSchema,
} from "./profile_tools";

const tool = (overrides: Record<string, unknown> = {}) => ({
	name: "lookup_order",
	description: "Find an order by its number",
	parameters: {
		type: "object",
		properties: { orderId: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
		required: ["orderId"],
		additionalProperties: false,
	},
	enabled: true,
	...overrides,
});

const issues = (tools: unknown[]) => {
	const result = profileToolsSchema.safeParse(tools);
	return result.success ? [] : result.error.issues.map((i) => i.message);
};

test("a valid tool list passes", () => {
	assert.deepEqual(issues([tool(), tool({ name: "cancel_order", enabled: false })]), []);
	assert.deepEqual(issues([]), []);
});

test("tool names: letter first, letters, digits and _, at most 64", () => {
	for (const name of ["a", "getWeather", "x_1", "A".repeat(64)]) {
		assert.deepEqual(issues([tool({ name })]), [], name);
	}
	for (const name of ["", "1abc", "_x", "has-dash", "has space", "A".repeat(65), "naïve"]) {
		assert.equal(issues([tool({ name })]).length, 1, name);
	}
});

test("tool names are unique within a profile", () => {
	const messages = issues([tool(), tool({ description: "Other" })]);
	assert.deepEqual(messages, ["Duplicate tool name: lookup_order"]);
});

test("description is 1 to 1024 characters", () => {
	assert.equal(issues([tool({ description: "" })]).length, 1);
	assert.equal(issues([tool({ description: "   " })]).length, 1);
	assert.equal(issues([tool({ description: "d".repeat(1025) })]).length, 1);
	assert.deepEqual(issues([tool({ description: "d".repeat(1024) })]), []);
});

test(`at most ${MAX_PROFILE_TOOLS} tools`, () => {
	const many = (n: number) => Array.from({ length: n }, (_, i) => tool({ name: `t${i}` }));
	assert.deepEqual(issues(many(MAX_PROFILE_TOOLS)), []);
	assert.equal(issues(many(MAX_PROFILE_TOOLS + 1)).length, 1);
});

test("enabled must be a boolean", () => {
	assert.equal(issues([tool({ enabled: "yes" })]).length, 1);
	assert.equal(issues([{ ...tool(), enabled: undefined }]).length, 1);
});

test("parameters must be an object schema of at most 8 KB", () => {
	assert.match(parametersSchemaError({ type: "string" })!, /type "object"/);
	assert.match(parametersSchemaError({ properties: {} })!, /type "object"/);
	const big = {
		type: "object",
		properties: { a: { type: "string", description: "x".repeat(8200) } },
	};
	assert.match(parametersSchemaError(big)!, /at most 8192 bytes/);
	assert.equal(issues([tool({ parameters: [] })]).length, 1);
});

test("parameters must compile in strict mode", () => {
	// Unknown keyword
	assert.match(parametersSchemaError({ type: "object", foo: 1 })!, /unknown keyword: "foo"/);
	// Wrong keyword value, or a required property that is not defined
	assert.ok(parametersSchemaError({ type: "object", required: "orderId" }));
	assert.match(
		parametersSchemaError({ type: "object", required: ["orderId"] })!,
		/required property "orderId" is not defined/,
	);
	// Remote references are never fetched
	assert.ok(
		parametersSchemaError({
			type: "object",
			properties: { a: { $ref: "https://example.com/schema.json" } },
		}),
	);
	// Local references are fine
	assert.equal(
		parametersSchemaError({
			type: "object",
			definitions: { id: { type: "string" } },
			properties: { a: { $ref: "#/definitions/id" } },
		}),
		null,
	);
});

test("pattern and patternProperties are rejected (ReDoS), even nested", () => {
	const message = /pattern and patternProperties are not supported/;
	assert.match(
		parametersSchemaError({
			type: "object",
			properties: { a: { type: "string", pattern: "^(a+)+$" } },
		})!,
		message,
	);
	assert.match(
		parametersSchemaError({ type: "object", patternProperties: { "^x": {} } })!,
		message,
	);
	assert.match(
		parametersSchemaError({ type: "object", propertyNames: { pattern: "^a" } })!,
		message,
	);
	// A property that is merely named "pattern" is fine
	assert.equal(
		parametersSchemaError({ type: "object", properties: { pattern: { type: "string" } } }),
		null,
	);
	assert.match(
		issues([tool({ parameters: { type: "object", patternProperties: { x: {} } } })])[0],
		message,
	);
});

test("formats are annotations only", () => {
	assert.equal(
		parametersSchemaError({
			type: "object",
			properties: { email: { type: "string", format: "email" } },
		}),
		null,
	);
	const tools = enabledTools([
		tool({
			parameters: { type: "object", properties: { email: { type: "string", format: "email" } } },
		}),
	]);
	assert.equal(checkToolCall(tools, "lookup_order", '{"email":"not an email"}').ok, true);
});

test("enabledTools keeps only enabled tools, without the flag", () => {
	const tools = enabledTools([tool(), tool({ name: "off", enabled: false })]);
	assert.deepEqual(
		tools.map((t) => t.name),
		["lookup_order"],
	);
	assert.equal("enabled" in tools[0], false);
	assert.deepEqual(enabledTools(null), []);
});

test("checkToolCall validates name, JSON and schema", () => {
	const tools = enabledTools([tool()]);

	const ok = checkToolCall(tools, "lookup_order", '{"orderId":"A-1","quantity":2}');
	assert.deepEqual(ok, { ok: true, arguments: { orderId: "A-1", quantity: 2 } });

	const unknown = checkToolCall(tools, "drop_tables", "{}");
	assert.equal(unknown.ok, false);
	assert.equal(!unknown.ok && unknown.error.error, "unknown_tool");

	const badJson = checkToolCall(tools, "lookup_order", '{"orderId":');
	assert.equal(!badJson.ok && badJson.error.error, "invalid_arguments");

	const missing = checkToolCall(tools, "lookup_order", '{"quantity":0}');
	assert.equal(missing.ok, false);
	assert.equal(!missing.ok && missing.error.error, "invalid_arguments");
	assert.match(!missing.ok ? missing.error.details : "", /orderId/);
});

test("checkToolCall refuses oversized arguments before validating", () => {
	const tools = enabledTools([
		tool({
			parameters: {
				type: "object",
				properties: { items: { type: "array", uniqueItems: true } },
			},
		}),
	]);
	const items = Array.from({ length: 4000 }, (_, i) => ({ i }));
	const result = checkToolCall(tools, "lookup_order", JSON.stringify({ items }));
	assert.equal(result.ok, false);
	assert.match(!result.ok ? result.error.details : "", /longer than 16000 characters/);
});

test("checkToolCall errors never echo argument values", () => {
	const tools = enabledTools([tool()]);
	const secret = "jane.doe@example.com";
	for (const args of [
		`{"orderId": 42, "note": "${secret}"}`,
		`{"orderId": "${secret}", "quantity": "${secret}"}`,
		`{"orderId": "${secret}"`,
	]) {
		const result = checkToolCall(tools, "lookup_order", args);
		assert.equal(result.ok, false);
		assert.equal(JSON.stringify(result).includes(secret), false, args);
	}
});

test("validators are cached per tool set, and sets do not share $ids", () => {
	const a = enabledTools([
		tool({
			parameters: {
				$id: "shared",
				type: "object",
				properties: { x: {}, y: {} },
				required: ["x"],
			},
		}),
	]);
	const b = enabledTools([
		tool({
			parameters: {
				$id: "shared",
				type: "object",
				properties: { x: {}, y: {} },
				required: ["y"],
			},
		}),
	]);
	assert.equal(checkToolCall(a, "lookup_order", '{"x":1}').ok, true);
	assert.equal(checkToolCall(b, "lookup_order", '{"x":1}').ok, false);
	assert.equal(checkToolCall(a, "lookup_order", '{"y":1}').ok, false);
});

test("migration 0003 adds rag_profile.tools as a non-null jsonb array", () => {
	const dir = path.resolve(__dirname, "../../../../packages/db/drizzle");
	const sql = readFileSync(path.join(dir, "0003_profile_tools.sql"), "utf8");
	assert.match(
		sql,
		/ALTER TABLE "rag_profile" ADD COLUMN "tools" jsonb DEFAULT '\[\]'::jsonb NOT NULL;/,
	);
	const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
		entries: { tag: string }[];
	};
	assert.ok(journal.entries.some((e) => e.tag === "0003_profile_tools"));
});
