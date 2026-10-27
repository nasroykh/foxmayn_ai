import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChunkFilter, isVectorCollection } from "./qdrant.filter";

test("buildChunkFilter always scopes by userId", () => {
	assert.deepEqual(buildChunkFilter({ userId: "u1" }), {
		must: [{ key: "userId", match: { value: "u1" } }],
	});
});

test("buildChunkFilter adds documentId and source after userId", () => {
	assert.deepEqual(
		buildChunkFilter({ userId: "u1", documentId: "d1", source: "s1" }),
		{
			must: [
				{ key: "userId", match: { value: "u1" } },
				{ key: "documentId", match: { value: "d1" } },
				{ key: "source", match: { value: "s1" } },
			],
		},
	);
});

test("buildChunkFilter refuses an empty userId", () => {
	assert.throws(() => buildChunkFilter({ userId: "" }));
});

test("isVectorCollection matches only <base>_<dims>", () => {
	assert.equal(isVectorCollection("foxmayn_ai_1536", "foxmayn_ai"), true);
	assert.equal(isVectorCollection("foxmayn_ai_3072", "foxmayn_ai"), true);
	assert.equal(isVectorCollection("foxmayn_ai", "foxmayn_ai"), false);
	assert.equal(isVectorCollection("foxmayn_ai_x", "foxmayn_ai"), false);
	assert.equal(isVectorCollection("other_1536", "foxmayn_ai"), false);
});
