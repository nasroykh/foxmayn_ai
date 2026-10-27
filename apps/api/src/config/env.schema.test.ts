import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	envSchema,
	findPlaceholderEnvKeys,
	isKnownExampleSecret,
} from "./env.schema";

const validEnv = {
	NODE_ENV: "production",
	APP_URL: "https://app.example.com",
	BETTER_AUTH_SECRET: "x".repeat(40),
	SUPER_ADMIN_EMAIL: "admin@example.com",
	SUPER_ADMIN_PASSWORD: "a-long-real-password",
	DB_URL: "postgresql://user:pw@db:5432/app",
	SMTP_HOST: "smtp.example.com",
	SMTP_PORT: "587",
	SMTP_USER: "mailer",
	SMTP_PASSWORD: "mailer-pw",
	SMTP_FROM: "noreply@example.com",
	REDIS_URL: "redis://:pass@redis:6379",
	OPENROUTER_API_KEY: "sk-or-real",
	QDRANT_URL: "http://qdrant:6333",
};

test("valid env parses and applies defaults", () => {
	const parsed = envSchema.parse(validEnv);
	assert.equal(parsed.PORT, 33450);
	assert.equal(parsed.HOST, "0.0.0.0");
	assert.equal(parsed.API_V1_PREFIX, "/api/v1");
	assert.equal(parsed.QDRANT_COLLECTION_NAME, "documents");
	assert.equal(parsed.QDRANT_API_KEY, undefined);
});

test("empty QDRANT_API_KEY becomes undefined", () => {
	assert.equal(
		envSchema.parse({ ...validEnv, QDRANT_API_KEY: "" }).QDRANT_API_KEY,
		undefined,
	);
});

test("rejects short auth secret and admin password", () => {
	assert.equal(
		envSchema.safeParse({ ...validEnv, BETTER_AUTH_SECRET: "short" }).success,
		false,
	);
	assert.equal(
		envSchema.safeParse({ ...validEnv, SUPER_ADMIN_PASSWORD: "short" }).success,
		false,
	);
});

test("production rejects CHANGE_ME placeholders", () => {
	const result = envSchema.safeParse({
		...validEnv,
		BETTER_AUTH_SECRET: "CHANGE_ME".padEnd(40, "x"),
		DB_URL: "postgresql://user:CHANGE_ME@db:5432/app",
	});
	assert.equal(result.success, false);
	const paths = result.error?.issues.map((issue) => issue.path[0]);
	assert.deepEqual(paths?.sort(), ["BETTER_AUTH_SECRET", "DB_URL"]);
});

test("known example secrets are matched by hash", () => {
	const hashes = new Set([
		createHash("sha256").update("leaked-example-value").digest("hex"),
	]);
	assert.equal(isKnownExampleSecret("leaked-example-value", hashes), true);
	assert.equal(isKnownExampleSecret("another-value", hashes), false);
});

test("development tolerates placeholders", () => {
	const result = envSchema.safeParse({
		...validEnv,
		NODE_ENV: "development",
		SMTP_PASSWORD: "change-me",
	});
	assert.equal(result.success, true);
});

test("findPlaceholderEnvKeys ignores non-string values", () => {
	assert.deepEqual(findPlaceholderEnvKeys({ PORT: 1, A: "CHANGE_ME", B: "ok" }), [
		"A",
	]);
});
