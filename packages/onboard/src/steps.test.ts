import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClient } from "./http";
import { redactor } from "./plan";
import { runOnboard, shouldImport } from "./steps";
import { json, routerFetch, samplePack, type Call } from "./test-helpers";

const noWait = { retries: 0, baseDelayMs: 0, sleep: async () => {} };
const PASSWORD = "s3cret-pass-word";

describe("shouldImport", () => {
	const doc = { url: "https://acme.example/a.pdf" };
	it("skips an indexed document with the same source", () => {
		assert.equal(shouldImport(doc, [{ source: doc.url, status: "indexed" }], false), false);
	});
	it("imports when missing, not indexed, or another source", () => {
		assert.equal(shouldImport(doc, [], false), true);
		assert.equal(shouldImport(doc, [{ source: doc.url, status: "failed" }], false), true);
		assert.equal(shouldImport(doc, [{ source: doc.url, status: "processing" }], false), true);
		assert.equal(shouldImport(doc, [{ source: "https://other", status: "indexed" }], false), true);
	});
	it("always imports with reimport", () => {
		assert.equal(shouldImport(doc, [{ source: doc.url, status: "indexed" }], true), true);
	});
});

interface World {
	orgs?: { id: string; slug: string }[];
	profiles?: { id: string; name: string }[];
	documents?: { id: string; source: string; status: string }[];
}

const run = async (world: World, over: { topup?: number; reimport?: boolean; wait?: boolean } = {}) => {
	const logs: string[] = [];
	const statuses = new Map<string, string>();
	let n = 0;
	const { fetch, calls } = routerFetch({
		"POST /api/v1/auth/sign-in/email": () =>
			json({ ok: true }, 200, new Headers({ "content-type": "application/json", "set-cookie": "session=abc123; Path=/" })),
		"GET /api/v1/organizations": () => json(world.orgs ?? []),
		"POST /api/v1/organizations": () => json({ id: "org_new", slug: "acme-tools" }),
		"POST /api/v1/auth/organization/set-active": () => json({}),
		"POST /api/v1/credits/topup": () => json({ ok: true }),
		"GET /api/v1/credits/balance": () => json({ balance: "7.5" }),
		"PATCH /api/v1/credits/cap": () => json({ monthlyCap: 5 }),
		"GET /api/v1/profiles": () => json({ profiles: world.profiles ?? [] }),
		"POST /api/v1/profiles": () => json({ id: "prof_new" }),
		"PUT /api/v1/profiles/prof_old": () => json({}),
		"GET /api/v1/documents": () =>
			json({ documents: world.documents ?? [], total: (world.documents ?? []).length }),
		"POST /api/v1/documents/import": (call: Call) => {
			if (call.body?.title === "Saw B" && over.wait === undefined && world.documents === undefined) {
				return json({ message: "boom" }, 400);
			}
			const id = `doc_${++n}`;
			statuses.set(id, call.body?.title === "Saw B" ? "failed" : "indexed");
			return json({ documentId: id });
		},
		"PUT /api/v1/public-sites/acme.example.com": () => json({}),
	});
	const wrapped: typeof fetch = async (url, init) => {
		const m = /\/documents\/(doc_\d+)$/.exec(url);
		if (m && init.method === "GET") {
			const status = statuses.get(m[1] as string) ?? "processing";
			return json({ id: m[1], status, metadata: status === "failed" ? { error: "scan unreadable" } : {} });
		}
		return fetch(url, init);
	};
	const result = await runOnboard({
		client: createClient({ baseUrl: "https://demo.example/", fetch: wrapped, retry: noWait }),
		pack: samplePack(),
		email: "ops@example.com",
		password: PASSWORD,
		log: (l) => logs.push(redactor([PASSWORD])(l)),
		sleep: async () => {},
		...over,
	});
	return { result, logs, calls };
};

describe("runOnboard", () => {
	it("creates org and profile, imports documents, sets the site", async () => {
		const { result, logs, calls } = await run({});
		assert.equal(result.organizationId, "org_new");
		assert.equal(result.profileId, "prof_new");
		assert.equal(result.imported, 1);
		assert.equal(result.failed, 1);
		assert.match(logs.join("\n"), /organization: created acme-tools/);
		assert.match(logs.join("\n"), /profile: created/);
		assert.match(logs.join("\n"), /failed: Saw B: HTTP 400: boom/);
		const site = calls.find((c) => c.method === "PUT" && c.path.includes("public-sites"));
		assert.deepEqual(site?.body, {
			profileId: "prof_new",
			settings: { title: "Ask Acme", suggestions: ["Which drill fits concrete?"] },
			enabled: true,
		});
		const imp = calls.find((c) => c.path === "/api/v1/documents/import");
		assert.equal(imp?.body?.replace, true);
		assert.deepEqual(imp?.body?.metadata, { family: "Drills" });
		// Origin on every call, session cookie after sign-in, active org set
		assert.ok(calls.every((c) => c.headers.origin === "https://demo.example"));
		assert.equal(calls[1]?.headers.cookie, "session=abc123");
		assert.ok(calls.some((c) => c.path === "/api/v1/auth/organization/set-active" && c.body?.organizationId === "org_new"));
	});

	it("reuses an existing org and profile, skips indexed documents", async () => {
		const { result, logs, calls } = await run({
			orgs: [{ id: "org_old", slug: "acme-tools" }],
			profiles: [{ id: "prof_old", name: "Acme assistant" }],
			documents: [
				{ id: "d1", source: "https://acme.example/a.pdf", status: "indexed" },
				{ id: "d2", source: "https://acme.example/b.pdf", status: "failed" },
			],
		});
		assert.equal(result.organizationId, "org_old");
		assert.equal(result.profileId, "prof_old");
		assert.equal(result.skipped, 1);
		assert.equal(result.imported, 1);
		assert.match(logs.join("\n"), /organization: found/);
		assert.match(logs.join("\n"), /profile: updated/);
		assert.match(logs.join("\n"), /documents: imported 1, skipped 1, failed 0/);
		assert.ok(!calls.some((c) => c.method === "POST" && c.path === "/api/v1/organizations"));
		assert.ok(calls.some((c) => c.method === "GET" && c.path.startsWith("/api/v1/documents?") && c.path.includes("profileId=prof_old")));
		const put = calls.find((c) => c.path === "/api/v1/profiles/prof_old");
		assert.deepEqual(put?.body, { data: { name: "Acme assistant", tone: "professional" } });
	});

	it("reimport imports even indexed documents", async () => {
		const { result } = await run(
			{
				orgs: [{ id: "org_old", slug: "acme-tools" }],
				documents: [
					{ id: "d1", source: "https://acme.example/a.pdf", status: "indexed" },
					{ id: "d2", source: "https://acme.example/b.pdf", status: "indexed" },
				],
			},
			{ reimport: true },
		);
		assert.equal(result.skipped, 0);
		assert.equal(result.imported, 2);
	});

	it("topup prints the balance, wait reports statuses and errors", async () => {
		const { result, logs } = await run(
			{ orgs: [{ id: "org_old", slug: "acme-tools" }], documents: [] },
			{ topup: 10, wait: true },
		);
		assert.match(logs.join("\n"), /credits: topped up \$10, balance 7.5/);
		assert.deepEqual(result.waitCounts, { indexed: 1, failed: 1 });
		assert.match(logs.join("\n"), /document error: scan unreadable/);
	});

	it("no log line holds the password, even when an error echoes it", async () => {
		const logs: string[] = [];
		const { fetch } = routerFetch({
			"POST /api/v1/auth/sign-in/email": () => json({ message: `bad ${PASSWORD}` }, 401),
		});
		const redact = redactor([PASSWORD]);
		await assert.rejects(
			() =>
				runOnboard({
					client: createClient({ baseUrl: "https://demo.example", fetch, retry: noWait }),
					pack: samplePack(),
					email: "ops@example.com",
					password: PASSWORD,
					log: (l) => logs.push(redact(l)),
				}),
			(err: Error) => {
				assert.ok(!redact(err.message).includes(PASSWORD));
				return true;
			},
		);
		const ok = await run({});
		assert.ok(![...logs, ...ok.logs].some((l) => l.includes(PASSWORD)));
		assert.ok(!ok.logs.some((l) => l.includes("abc123")));
	});
});
