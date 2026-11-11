import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddingInput } from "./chunking.service";

test("embeddingInput puts the trimmed title before the chunk", () => {
	assert.equal(embeddingInput(" Imprimante 3D NOVA ", "Volume 300 x 200 x 270 mm"), "Imprimante 3D NOVA\n\nVolume 300 x 200 x 270 mm");
});

test("embeddingInput keeps the chunk alone without a title", () => {
	for (const title of [null, undefined, "", "   "]) {
		assert.equal(embeddingInput(title, "chunk"), "chunk");
	}
});
