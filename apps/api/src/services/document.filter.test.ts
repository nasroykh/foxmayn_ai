import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { searchableDocumentsFilter } from "./document.filter";

const dialect = new PgDialect();
const render = (options: Parameters<typeof searchableDocumentsFilter>[0]) => {
	const condition = searchableDocumentsFilter(options);
	assert.ok(condition);
	return dialect.sqlToQuery(condition);
};

const base = {
	userId: "user-1",
	embeddingModel: "openai/text-embedding-3-small",
	profile: { id: "profile-1", isDefault: false },
	strictProfile: true,
};

test("sourcePrefix narrows the profile scope with a prefix match", () => {
	const { sql, params } = render({
		...base,
		sourcePrefix: "https://foxmayn.com/en/",
	});
	assert.match(sql, /"document"\."source" like \$\d+/);
	assert.ok(params.includes("https://foxmayn.com/en/%"));
});

test("sourcePrefix never widens the scope: owner and profile stay required", () => {
	const { sql, params } = render({ ...base, sourcePrefix: "https://" });
	// Every condition is AND-ed: no OR that a prefix could satisfy on its own
	assert.doesNotMatch(sql, / or /);
	assert.match(sql, /"document"\."user_id" = \$\d+/);
	assert.match(sql, /"document"\."profile_id" = \$\d+/);
	assert.match(sql, /"document"\."embedding_model" = \$\d+/);
	assert.match(sql, /"document"\."status" = \$\d+/);
	assert.ok(params.includes("user-1"));
	assert.ok(params.includes("profile-1"));
	assert.ok(params.includes("indexed"));
});

test("sourcePrefix also keeps the default profile's OR inside the AND", () => {
	const { sql } = render({
		...base,
		profile: { id: "profile-1", isDefault: true },
		strictProfile: false,
		sourcePrefix: "https://foxmayn.com/fr/",
	});
	// The only OR is the default profile's own (profile or no profile), nested
	assert.match(
		sql,
		/\("document"\."profile_id" = \$\d+ or "document"\."profile_id" is null\)\) and/,
	);
	assert.match(sql, /and "document"\."source" like \$\d+\)$/);
});

test("LIKE wildcards in the prefix are matched literally", () => {
	const { params } = render({ ...base, sourcePrefix: "a_b%c\\" });
	assert.ok(params.includes("a\\_b\\%c\\\\%"));
});

test("without sourcePrefix there is no source condition", () => {
	const { sql } = render(base);
	assert.doesNotMatch(sql, /source/);
});

test("excludeSourcePrefixes drops matching sources and keeps sourceless documents", () => {
	const { sql, params } = render({
		...base,
		excludeSourcePrefixes: ["https://foxmayn.com/en/dz"],
	});
	assert.match(
		sql,
		/\("document"\."source" is null or "document"\."source" not like \$\d+\)\)$/,
	);
	assert.ok(params.includes("https://foxmayn.com/en/dz%"));
});

test("excludeSourcePrefixes combines with sourcePrefix: both AND-ed", () => {
	const { sql, params } = render({
		...base,
		sourcePrefix: "https://foxmayn.com/en",
		excludeSourcePrefixes: ["https://foxmayn.com/en/dz", "https://foxmayn.com/en/ma"],
	});
	assert.match(
		sql,
		/and "document"\."source" like \$\d+ and \("document"\."source" is null or "document"\."source" not like \$\d+\) and \("document"\."source" is null or "document"\."source" not like \$\d+\)\)$/,
	);
	// Owner and profile stay required
	assert.match(sql, /^\(\("document"\."user_id" = \$\d+ and "document"\."profile_id" = \$\d+\) and/);
	assert.ok(params.includes("https://foxmayn.com/en%"));
	assert.ok(params.includes("https://foxmayn.com/en/dz%"));
	assert.ok(params.includes("https://foxmayn.com/en/ma%"));
});

test("LIKE wildcards in an excluded prefix are matched literally", () => {
	const { params } = render({ ...base, excludeSourcePrefixes: ["a_b%c\\"] });
	assert.ok(params.includes("a\\_b\\%c\\\\%"));
});

test("an empty excludeSourcePrefixes adds no source condition", () => {
	const { sql } = render({ ...base, excludeSourcePrefixes: [] });
	assert.doesNotMatch(sql, /source/);
});
