import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePack } from "./pack";

const good = () => ({
	slug: "acme-tools",
	company: { name: "Acme Tools Ltd", website: "https://acme.example" },
	profile: { name: "Acme assistant", tone: "professional" },
	hostnames: ["Acme.Example.com"],
	documents: [{ url: "https://acme.example/a.pdf", title: "Drill A", family: "Drills" }],
});

const bad = (mutate: (p: Record<string, unknown>) => void) => {
	const p = good() as Record<string, unknown>;
	mutate(p);
	return () => parsePack(JSON.stringify(p));
};

describe("parsePack", () => {
	it("accepts a good pack, site optional, hostnames lowercased, profile passthrough", () => {
		const pack = parsePack(JSON.stringify(good()));
		assert.equal(pack.slug, "acme-tools");
		assert.deepEqual(pack.hostnames, ["acme.example.com"]);
		assert.equal(pack.site, undefined);
		assert.equal(pack.profile.tone, "professional");
	});

	it("names each bad field", () => {
		assert.throws(bad((p) => (p.slug = "Bad Slug")), /slug/);
		assert.throws(bad((p) => delete p.company), /company/);
		assert.throws(bad((p) => (p.company = { name: "" })), /company\.name/);
		assert.throws(bad((p) => delete p.profile), /profile/);
		assert.throws(bad((p) => (p.profile = { tone: "x" })), /profile\.name/);
		assert.throws(bad((p) => (p.hostnames = ["nodot"])), /hostnames\.0/);
		assert.throws(bad((p) => (p.monthlyCapUsd = -1)), /monthlyCapUsd/);
		assert.throws(bad((p) => (p.documents = [{ url: "http://x.example/a.pdf", title: "t" }])), /documents\.0\.url/);
		assert.throws(bad((p) => (p.documents = [{ url: "https://x.example/a.pdf" }])), /documents\.0\.title/);
		assert.throws(bad((p) => (p.site = { title: "t", colour: "red" })), /site/);
		assert.throws(bad((p) => (p.site = { title: "x".repeat(101) })), /site\.title/);
		assert.throws(bad((p) => (p.site = { suggestions: Array(7).fill("q") })), /site\.suggestions/);
	});

	it("accepts a null cap and rejects non-JSON", () => {
		assert.equal(parsePack(JSON.stringify({ ...good(), monthlyCapUsd: null })).monthlyCapUsd, null);
		assert.throws(() => parsePack("{nope"), /not valid JSON/);
	});
});
