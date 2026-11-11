import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, HttpError } from "./http";
import { json, routerFetch } from "./test-helpers";

const noWait = { retries: 3, baseDelayMs: 0, sleep: async () => {} };

const flaky = (status: number) => {
	let n = 0;
	return routerFetch({
		"POST /x": () => (++n === 1 ? json({ message: "down" }, status) : json({ ok: true })),
		"GET /x": () => (++n === 1 ? json({ message: "down" }, status) : json({ ok: true })),
	});
};

describe("createClient retries", () => {
	it("does not repeat a POST after a 5xx", async () => {
		const { fetch, calls } = flaky(502);
		const client = createClient({ baseUrl: "https://demo.example", fetch, retry: noWait });
		await assert.rejects(() => client.request("POST", "/x", {}), (e) => e instanceof HttpError && e.status === 502);
		assert.equal(calls.length, 1);
	});

	it("does not repeat a POST after a network error", async () => {
		let n = 0;
		const fetch = async () => {
			n++;
			throw new Error("reset");
		};
		const client = createClient({ baseUrl: "https://demo.example", fetch, retry: noWait });
		await assert.rejects(() => client.request("POST", "/x", {}), /Network error/);
		assert.equal(n, 1);
	});

	it("repeats a POST after a 429 and a GET after a 5xx", async () => {
		const post = flaky(429);
		await createClient({ baseUrl: "https://demo.example", fetch: post.fetch, retry: noWait }).request("POST", "/x", {});
		assert.equal(post.calls.length, 2);
		const get = flaky(503);
		await createClient({ baseUrl: "https://demo.example", fetch: get.fetch, retry: noWait }).request("GET", "/x");
		assert.equal(get.calls.length, 2);
	});

	it("a body that is not JSON is an HttpError without the body", async () => {
		const fetch = async () => new Response("<html>secret page</html>", { status: 200 });
		const client = createClient({ baseUrl: "https://demo.example", fetch, retry: noWait });
		await assert.rejects(
			() => client.request("GET", "/x"),
			(e) => e instanceof HttpError && !e.message.includes("secret"),
		);
	});
});
