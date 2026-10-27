import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

import { rejectApiKeyHeader } from "./api-key-guard";

const makeApp = () => {
	const app = new Hono();
	app.use("/auth/*", rejectApiKeyHeader);
	app.on(["GET", "POST"], "/auth/*", (c) => c.text("ok"));
	app.get("/other", (c) => c.text("ok"));
	return app;
};

test("rejects /auth requests that carry an API key header", async () => {
	const res = await makeApp().request("/auth/api-key/create", {
		method: "POST",
		headers: { "x-api-key": "sk_live_example" },
	});
	assert.equal(res.status, 403);
});

test("header name match is case-insensitive", async () => {
	const res = await makeApp().request("/auth/get-session", {
		headers: { "X-API-Key": "sk_live_example" },
	});
	assert.equal(res.status, 403);
});

test("allows /auth requests without an API key header", async () => {
	const res = await makeApp().request("/auth/get-session");
	assert.equal(res.status, 200);
});

test("does not affect other routes", async () => {
	const res = await makeApp().request("/other", {
		headers: { "x-api-key": "sk_live_example" },
	});
	assert.equal(res.status, 200);
});
