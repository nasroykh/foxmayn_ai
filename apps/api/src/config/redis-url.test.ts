import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRedisUrl } from "./redis-url";

test("plain url gets default port", () => {
	assert.deepEqual(parseRedisUrl("redis://localhost"), {
		host: "localhost",
		port: 6379,
		username: undefined,
		password: undefined,
		db: undefined,
		tls: undefined,
	});
});

test("password-only url", () => {
	const parsed = parseRedisUrl("redis://:s3cret@redis:6380");
	assert.equal(parsed.password, "s3cret");
	assert.equal(parsed.username, undefined);
	assert.equal(parsed.port, 6380);
});

test("username, encoded password and db index", () => {
	const parsed = parseRedisUrl("redis://app:p%40ss%2Fword@redis:6379/3");
	assert.equal(parsed.username, "app");
	assert.equal(parsed.password, "p@ss/word");
	assert.equal(parsed.db, 3);
});

test("rediss enables tls with servername", () => {
	assert.deepEqual(parseRedisUrl("rediss://cache.example.com:6380").tls, {
		servername: "cache.example.com",
	});
});

test("rejects other protocols", () => {
	assert.throws(() => parseRedisUrl("http://localhost:6379"));
});
