import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { curlFetch } from "./curl_fetch";

describe("curlFetch", () => {
	const seen: { url?: string; agent?: string }[] = [];
	const server = createServer((req, res) => {
		seen.push({ url: req.url, agent: req.headers["user-agent"] });
		if (req.url === "/limited") {
			res.writeHead(429, { "content-type": "application/json" }).end('{"errors":"slow down"}');
			return;
		}
		res.writeHead(200, { "content-type": "application/json" }).end('{"products":[]}\n');
	});
	let base = "";

	before(async () => {
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	after(() => server.close());

	it("returns the status and the body, and sends the headers", async () => {
		const res = await curlFetch(`${base}/products.json?limit=250&page=1`, {
			headers: { "User-Agent": "Test/1.0" },
		});
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { products: [] });
		assert.deepEqual(seen.at(-1), { url: "/products.json?limit=250&page=1", agent: "Test/1.0" });
	});

	it("returns an error status without throwing", async () => {
		const res = await curlFetch(`${base}/limited`);
		assert.equal(res.status, 429);
		assert.equal(res.ok, false);
	});

	it("rejects when the server cannot be reached", async () => {
		await assert.rejects(() => curlFetch("http://127.0.0.1:1/"), /curl http:\/\/127\.0\.0\.1:1\//);
	});
});
