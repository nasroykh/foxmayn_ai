import { test } from "node:test";
import assert from "node:assert/strict";
import { formatContext } from "./context";

test("formatContext numbers passages and heads each with its title", () => {
	assert.equal(
		formatContext([
			{ title: "SIDAL SIDARC 220", content: "Courant de soudage 42 A - 220 A" },
			{ title: "  ", content: "No title" },
			{ title: null, content: "Null title" },
		]),
		"[1] SIDAL SIDARC 220\nCourant de soudage 42 A - 220 A\n\n[2] No title\n\n[3] Null title",
	);
});
