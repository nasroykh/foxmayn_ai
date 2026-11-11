import { test } from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/server";
import {
	assertHostnameAvailable,
	clientIpFromHeaders,
	hostnameSchema,
	isValidHostname,
	normalizeHostname,
	publicSiteSettingsSchema,
	requireEnabledSite,
	toPublicSources,
	resolveSiteWith,
	upsertSiteWith,
	UNKNOWN_IP,
} from "./public_site";

const rejectsWith = async (promise: Promise<unknown>, code: string) =>
	assert.rejects(promise, (error) => {
		assert.ok(error instanceof ORPCError);
		assert.equal(error.code, code);
		return true;
	});

const throwsWith = (fn: () => unknown, code: string) =>
	assert.throws(fn, (error) => {
		assert.ok(error instanceof ORPCError);
		assert.equal(error.code, code);
		return true;
	});

// --- Hostname ---------------------------------------------------------------

test("normalizeHostname lowercases and strips port and trailing dot", () => {
	assert.equal(normalizeHostname("2MP.Foxmayn.com"), "2mp.foxmayn.com");
	assert.equal(normalizeHostname("2mp.foxmayn.com:443"), "2mp.foxmayn.com");
	assert.equal(normalizeHostname("  2mp.foxmayn.com.  "), "2mp.foxmayn.com");
	assert.equal(normalizeHostname(null), "");
	assert.equal(normalizeHostname(undefined), "");
});

test("isValidHostname accepts DNS names with at least one dot", () => {
	assert.equal(isValidHostname("2mp.foxmayn.com"), true);
	assert.equal(isValidHostname("a-b.example.org"), true);
	assert.equal(isValidHostname("a.b"), true);
});

test("isValidHostname rejects bad names", () => {
	for (const host of [
		"",
		"localhost",
		"-a.example.com",
		"a-.example.com",
		"a..example.com",
		".example.com",
		"under_score.example.com",
		"exa mple.com",
		"example.com/path",
		"[::1]",
		"ünï.example.com",
		"UPPER.example.com",
		`${"a".repeat(64)}.example.com`,
		`${"a.".repeat(127)}com`,
	]) {
		assert.equal(isValidHostname(host), false, host);
	}
	// 253 characters is the limit
	const longest = `${"a".repeat(61)}.${"b".repeat(61)}.${"c".repeat(61)}.${"d".repeat(61)}.eeeee`;
	assert.equal(longest.length, 253);
	assert.equal(isValidHostname(longest), true);
	assert.equal(isValidHostname(`${longest}e`), false);
});

test("hostnameSchema normalizes then validates", () => {
	assert.equal(hostnameSchema.parse("2MP.Foxmayn.com:8080"), "2mp.foxmayn.com");
	assert.equal(hostnameSchema.safeParse("nodot").success, false);
	assert.equal(hostnameSchema.safeParse("a b.com").success, false);
});

// --- Settings ---------------------------------------------------------------

test("settings schema accepts the bounds and optional fields", () => {
	assert.deepEqual(publicSiteSettingsSchema.parse({}), {});
	const full = {
		title: "t".repeat(100),
		subtitle: "s".repeat(200),
		placeholder: "p".repeat(100),
		disclaimer: "d".repeat(300),
		suggestions: Array.from({ length: 6 }, () => "q".repeat(150)),
		supportText: "x".repeat(300),
		rateLimitText: "r".repeat(200),
	};
	assert.deepEqual(publicSiteSettingsSchema.parse(full), full);
});

test("settings schema rejects values over the bounds and unknown keys", () => {
	const bad = (value: unknown) =>
		assert.equal(publicSiteSettingsSchema.safeParse(value).success, false);
	bad({ title: "t".repeat(101) });
	bad({ subtitle: "s".repeat(201) });
	bad({ placeholder: "p".repeat(101) });
	bad({ disclaimer: "d".repeat(301) });
	bad({ supportText: "x".repeat(301) });
	bad({ rateLimitText: "r".repeat(201) });
	bad({ suggestions: Array.from({ length: 7 }, () => "q") });
	bad({ suggestions: ["q".repeat(151)] });
	bad({ suggestions: [""] });
	bad({ title: 5 });
	bad({ model: "openai/gpt-5" });
});

// --- Client IP --------------------------------------------------------------

test("clientIpFromHeaders reads x-real-ip and falls back to a shared bucket", () => {
	assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": " 203.0.113.9 " })), "203.0.113.9");
	assert.equal(clientIpFromHeaders(new Headers()), UNKNOWN_IP);
	assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "" })), UNKNOWN_IP);
	assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "x".repeat(65) })), UNKNOWN_IP);
	// X-Forwarded-For is spoofable and ignored
	assert.equal(
		clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.1" })),
		UNKNOWN_IP,
	);
});

// --- Site resolution --------------------------------------------------------

const site = (over: Partial<{ enabled: boolean }> = {}) => ({
	hostname: "2mp.foxmayn.com",
	enabled: true,
	userId: "u1",
	organizationId: "o1",
	...over,
});

test("requireEnabledSite: unknown or disabled is 404", () => {
	throwsWith(() => requireEnabledSite(null), "NOT_FOUND");
	throwsWith(() => requireEnabledSite(undefined), "NOT_FOUND");
	throwsWith(() => requireEnabledSite(site({ enabled: false })), "NOT_FOUND");
	assert.equal(requireEnabledSite(site()).hostname, "2mp.foxmayn.com");
});

test("resolveSiteWith looks the site up by normalized Host", async () => {
	const seen: string[] = [];
	const deps = {
		findSite: async (hostname: string) => {
			seen.push(hostname);
			return hostname === "2mp.foxmayn.com" ? site() : null;
		},
		getMemberRole: async () => "owner",
	};
	assert.equal((await resolveSiteWith(deps, "2MP.foxmayn.com:443")).organizationId, "o1");
	assert.deepEqual(seen, ["2mp.foxmayn.com"]);
	await rejectsWith(resolveSiteWith(deps, "other.example.com"), "NOT_FOUND");
	await rejectsWith(resolveSiteWith(deps, null), "NOT_FOUND");
});

test("resolveSiteWith: disabled site or removed member is 404", async () => {
	await rejectsWith(
		resolveSiteWith(
			{ findSite: async () => site({ enabled: false }), getMemberRole: async () => "owner" },
			"2mp.foxmayn.com",
		),
		"NOT_FOUND",
	);
	await rejectsWith(
		resolveSiteWith(
			{ findSite: async () => site(), getMemberRole: async () => null },
			"2mp.foxmayn.com",
		),
		"NOT_FOUND",
	);
});

// --- Management -------------------------------------------------------------

test("assertHostnameAvailable: another organization is a 409", () => {
	throwsWith(() => assertHostnameAvailable({ organizationId: "o2" }, "o1"), "CONFLICT");
	assertHostnameAvailable(null, "o1");
	assertHostnameAvailable({ organizationId: "o1" }, "o1");
});

const upsertInput = {
	hostname: "2mp.foxmayn.com",
	profileId: "p1",
	userId: "u1",
	organizationId: "o1",
};

const upsertDeps = (over: Partial<Parameters<typeof upsertSiteWith>[0]> = {}) => {
	const saved: unknown[] = [];
	const deps = {
		getProfile: async () => ({ id: "p1" }),
		findSite: async () => null,
		saveSite: async (input: unknown) => {
			saved.push(input);
			return { ok: true };
		},
		...over,
	};
	return { deps, saved };
};

test("upsertSiteWith: a profile the user does not own is rejected before any write", async () => {
	const asked: unknown[] = [];
	const { deps, saved } = upsertDeps({
		getProfile: async (profileId, userId) => {
			asked.push([profileId, userId]);
			return null;
		},
	});
	await rejectsWith(upsertSiteWith(deps, upsertInput), "NOT_FOUND");
	assert.deepEqual(asked, [["p1", "u1"]]);
	assert.equal(saved.length, 0);
});

test("upsertSiteWith: a hostname of another organization is a 409 and nothing is written", async () => {
	const { deps, saved } = upsertDeps({
		findSite: async () => ({ organizationId: "o2" }),
	});
	await rejectsWith(upsertSiteWith(deps, upsertInput), "CONFLICT");
	assert.equal(saved.length, 0);
});

test("upsertSiteWith: losing the race for a hostname is a 409", async () => {
	const { deps } = upsertDeps({ saveSite: async () => null });
	await rejectsWith(upsertSiteWith(deps, upsertInput), "CONFLICT");
});

test("upsertSiteWith: writes user and organization from the caller, omitted fields stay out", async () => {
	const { deps, saved } = upsertDeps({
		findSite: async () => ({ organizationId: "o1" }),
	});
	await upsertSiteWith(deps, upsertInput);
	assert.deepEqual(saved, [
		{
			hostname: "2mp.foxmayn.com",
			organizationId: "o1",
			changes: { profileId: "p1", userId: "u1" },
		},
	]);

	await upsertSiteWith(deps, {
		...upsertInput,
		enabled: false,
		settings: { title: "Hi" },
	});
	assert.deepEqual((saved[1] as { changes: unknown }).changes, {
		profileId: "p1",
		userId: "u1",
		enabled: false,
		settings: { title: "Hi" },
	});
});

// --- Public sources ---------------------------------------------------------

test("toPublicSources keeps only title and source, in order, without dropping or merging", () => {
	const results = [
		{ documentId: "d1", chunkId: "c1", content: "secret one", score: 0.9, title: "A", source: "https://a.example/x" },
		{ documentId: "d1", chunkId: "c2", content: "secret two", score: 0.8, title: "A", source: "https://a.example/x" },
		{ documentId: "d2", chunkId: "c3", content: "secret three", score: 0.7, title: "B", source: null },
	];
	const mapped = toPublicSources(results);
	assert.deepEqual(mapped, [
		{ title: "A", source: "https://a.example/x" },
		{ title: "A", source: "https://a.example/x" },
		{ title: "B", source: null },
	]);
	for (const entry of mapped) {
		assert.deepEqual(Object.keys(entry).sort(), ["source", "title"]);
	}
	assert.deepEqual(toPublicSources([]), []);
});
