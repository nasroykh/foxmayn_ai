import { test } from "node:test";
import assert from "node:assert/strict";
import { ragProfile } from "@repo/db/schema";
import { DEFAULT_EMBEDDING_MODEL } from "@repo/llm/openrouter";
import { AUTO_LANGUAGE } from "./system_prompts";

test("the profile column defaults match the code defaults", () => {
	assert.equal(ragProfile.embeddingModel.default, DEFAULT_EMBEDDING_MODEL);
	assert.equal(ragProfile.language.default, AUTO_LANGUAGE);
});
