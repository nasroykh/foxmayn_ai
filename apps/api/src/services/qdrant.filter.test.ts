import { test } from "node:test";
import assert from "node:assert/strict";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import {
	buildChunkFilter,
	collectionNameForModel,
	isVectorCollection,
} from "./qdrant.filter";

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

test("collectionNameForModel slugs the model id", () => {
	assert.equal(
		collectionNameForModel("foxmayn_ai", "openai/text-embedding-3-small"),
		"foxmayn_ai_openai_text_embedding_3_small",
	);
	assert.equal(
		collectionNameForModel("foxmayn_ai", "BAAI/bge-m3"),
		"foxmayn_ai_baai_bge_m3",
	);
});

test("every embedding model gets its own collection, even with equal dimensions", () => {
	const names = OPENROUTER_EMBEDDING_MODELS.map((m) =>
		collectionNameForModel("foxmayn_ai", m.id),
	);
	assert.equal(new Set(names).size, names.length);

	// text-embedding-3-large and gemini-embedding-001 are both 3072-dim
	assert.notEqual(
		collectionNameForModel("foxmayn_ai", "openai/text-embedding-3-large"),
		collectionNameForModel("foxmayn_ai", "google/gemini-embedding-001"),
	);
	for (const name of names) assert.match(name, /^[a-z0-9_]+$/);
});

test("isVectorCollection matches only collections of known models", () => {
	const known = collectionNameForModel("foxmayn_ai", "openai/text-embedding-3-small");
	assert.equal(isVectorCollection(known, "foxmayn_ai"), true);
	assert.equal(isVectorCollection("foxmayn_ai", "foxmayn_ai"), false);
	assert.equal(isVectorCollection("foxmayn_ai_1536", "foxmayn_ai"), false);
	assert.equal(isVectorCollection("foxmayn_ai_unknown_model", "foxmayn_ai"), false);
	assert.equal(isVectorCollection(known, "other"), false);
});
