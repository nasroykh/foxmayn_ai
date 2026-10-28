import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
	isAcceptableModelChange,
	isValidChunkOverlap,
	profileSettingsShape,
} from "./profile_schema";

const schema = z.object(profileSettingsShape);
const ok = (v: unknown) => schema.safeParse(v).success;

test("accepts sensible settings", () => {
	assert.equal(
		ok({
			chunkSize: 500,
			chunkOverlap: 50,
			topK: 5,
			maxTokens: 2048,
			temperature: 0.7,
			topP: 1,
			scoreThreshold: 0.3,
			tone: "friendly",
			responseLength: "balanced",
			reasoningEffort: "none",
			model: "google/gemini-2.5-flash-lite",
			embeddingModel: "openai/text-embedding-3-small",
		}),
		true,
	);
	assert.equal(ok({}), true);
});

test("rejects out-of-range numbers", () => {
	assert.equal(ok({ chunkSize: 1 }), false);
	assert.equal(ok({ chunkSize: 4001 }), false);
	assert.equal(ok({ chunkSize: 100.5 }), false);
	assert.equal(ok({ topK: 0 }), false);
	assert.equal(ok({ topK: 51 }), false);
	assert.equal(ok({ maxTokens: 0 }), false);
	assert.equal(ok({ maxTokens: 32001 }), false);
	assert.equal(ok({ temperature: -0.1 }), false);
	assert.equal(ok({ temperature: 2.1 }), false);
	assert.equal(ok({ topP: 1.1 }), false);
	assert.equal(ok({ scoreThreshold: -1 }), false);
	assert.equal(ok({ scoreThreshold: 1.5 }), false);
});

test("accepts the boundary values", () => {
	assert.equal(ok({ chunkSize: 100, chunkOverlap: 0, topK: 1, maxTokens: 1 }), true);
	assert.equal(ok({ chunkSize: 4000, topK: 50, maxTokens: 32000, temperature: 2 }), true);
	assert.equal(ok({ topP: 0, scoreThreshold: 0 }), true);
});

test("rejects unknown models and enum values", () => {
	// Chat models are checked against the live list by isAcceptableModelChange
	assert.equal(isAcceptableModelChange("evil/expensive-model"), false);
	assert.equal(isAcceptableModelChange("openai/text-embedding-3-small"), false);
	assert.equal(isAcceptableModelChange("anthropic/claude-haiku-5.5"), true);
	assert.equal(ok({ model: "" }), false);
	assert.equal(ok({ embeddingModel: "openai/gpt-5" }), false);
	assert.equal(ok({ tone: "angry" }), false);
	assert.equal(ok({ responseLength: "huge" }), false);
	assert.equal(ok({ reasoningEffort: "extreme" }), false);
});

test("chunk overlap must be smaller than chunk size", () => {
	assert.equal(isValidChunkOverlap(500, 50), true);
	assert.equal(isValidChunkOverlap(500, 499), true);
	assert.equal(isValidChunkOverlap(500, 500), false);
	assert.equal(isValidChunkOverlap(100, 600), false);
});

