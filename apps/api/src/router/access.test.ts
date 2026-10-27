import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createTtlCache,
	hasAdminRole,
	hasRole,
	touchesPrivilegedUserFields,
	isOrgManager,
	isUserBanned,
	parseApiKeyOrganizationId,
} from "./access";

test("hasRole handles comma-separated and missing roles", () => {
	assert.equal(hasRole("user, admin", ["admin"]), true);
	assert.equal(hasRole("user", ["admin"]), false);
	assert.equal(hasRole(null, ["admin"]), false);
	assert.equal(hasAdminRole("admin"), true);
	assert.equal(hasAdminRole("administrator"), false);
});

test("isOrgManager accepts owner and admin only", () => {
	assert.equal(isOrgManager("owner"), true);
	assert.equal(isOrgManager("admin"), true);
	assert.equal(isOrgManager("member"), false);
	assert.equal(isOrgManager(undefined), false);
});

test("isUserBanned respects banExpires", () => {
	const now = Date.parse("2026-01-01T00:00:00Z");
	assert.equal(isUserBanned({ banned: false }, now), false);
	assert.equal(isUserBanned({ banned: null }, now), false);
	assert.equal(isUserBanned({ banned: true }, now), true);
	assert.equal(
		isUserBanned({ banned: true, banExpires: new Date(now + 1000) }, now),
		true,
	);
	assert.equal(
		isUserBanned({ banned: true, banExpires: new Date(now - 1000) }, now),
		false,
	);
});

test("parseApiKeyOrganizationId reads plain and double-stringified metadata", () => {
	assert.equal(parseApiKeyOrganizationId({ organizationId: "o1" }), "o1");
	assert.equal(parseApiKeyOrganizationId('{"organizationId":"o2"}'), "o2");
	assert.equal(
		parseApiKeyOrganizationId(JSON.stringify(JSON.stringify({ organizationId: "o3" }))),
		"o3",
	);
	assert.equal(parseApiKeyOrganizationId(null), null);
	assert.equal(parseApiKeyOrganizationId("not json"), null);
	assert.equal(parseApiKeyOrganizationId("{}"), null);
	assert.equal(parseApiKeyOrganizationId({ organizationId: 5 }), null);
});

test("ttl cache expires entries", () => {
	let t = 0;
	const cache = createTtlCache<string>(100, 10, () => t);
	cache.set("a", "x");
	assert.equal(cache.get("a"), "x");
	t = 99;
	assert.equal(cache.get("a"), "x");
	t = 100;
	assert.equal(cache.get("a"), undefined);
});

test("ttl cache evicts the oldest entry at capacity and supports delete", () => {
	const t = 0;
	const cache = createTtlCache<number>(1000, 2, () => t);
	cache.set("a", 1);
	cache.set("b", 2);
	cache.set("c", 3);
	assert.equal(cache.get("a"), undefined);
	assert.equal(cache.get("b"), 2);
	assert.equal(cache.get("c"), 3);
	cache.delete("b");
	assert.equal(cache.get("b"), undefined);
	cache.clear();
	assert.equal(cache.get("c"), undefined);
});

test("touchesPrivilegedUserFields flags role and ban fields only", () => {
	assert.equal(touchesPrivilegedUserFields({ name: "x", email: "a@b.c" }), false);
	assert.equal(touchesPrivilegedUserFields({ role: "user" }), true);
	assert.equal(touchesPrivilegedUserFields({ banned: false }), true);
	assert.equal(touchesPrivilegedUserFields({ banExpires: null }), true);
});

test("TtlCache.deleteWhere removes matching keys only", () => {
	const cache = createTtlCache<string>(1000);
	cache.set("u1:org-a", "admin");
	cache.set("u2:org-a", "member");
	cache.set("u1:org-b", "owner");
	cache.deleteWhere((key) => key.endsWith(":org-a"));
	assert.equal(cache.get("u1:org-a"), undefined);
	assert.equal(cache.get("u2:org-a"), undefined);
	assert.equal(cache.get("u1:org-b"), "owner");
});
