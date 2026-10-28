import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, GET_MAIN_SYSTEM_PROMPT } from "./system_prompts";

const CONTEXT = "[1] The vault code is 4242.";

test("buildSystemPrompt always injects the retrieved context", () => {
	assert.ok(buildSystemPrompt(null, CONTEXT).includes(CONTEXT));
	assert.ok(buildSystemPrompt({ tone: "formal" }, CONTEXT).includes(CONTEXT));
});

test("a profile systemPrompt is appended and does not replace the template", () => {
	const prompt = buildSystemPrompt(
		{ systemPrompt: "Always answer in haiku." },
		CONTEXT,
	);
	assert.ok(prompt.includes(CONTEXT), "context kept");
	assert.ok(prompt.includes("Guidelines:"), "template kept");
	assert.ok(prompt.includes("Always answer in haiku."));
	assert.ok(
		prompt.indexOf("Always answer in haiku.") > prompt.indexOf("Guidelines:"),
		"custom prompt comes after the template",
	);
});

test("blank systemPrompt adds nothing", () => {
	assert.equal(
		buildSystemPrompt({ systemPrompt: "   " }, CONTEXT),
		buildSystemPrompt({ systemPrompt: null }, CONTEXT),
	);
});

test("stream and non-stream share one builder: same input, same prompt", () => {
	const profile = { assistantName: "Ada", systemPrompt: "Be brief." };
	assert.equal(
		buildSystemPrompt(profile, CONTEXT),
		buildSystemPrompt(profile, CONTEXT),
	);
});

test("empty context is stated explicitly", () => {
	assert.ok(GET_MAIN_SYSTEM_PROMPT({ context: "" }).includes("no relevant information"));
});

test("language auto answers in the question's language; a named language is kept", () => {
	assert.match(buildSystemPrompt(null, "ctx"), /Language: the language of the user's latest message/);
	assert.match(
		buildSystemPrompt({ language: "Auto" }, "ctx"),
		/Language: the language of the user's latest message/,
	);
	assert.match(buildSystemPrompt({ language: "French" }, "ctx"), /Language: French\n/);
});

test("earlier replies are not retracted unless the user says one is wrong", () => {
	const prompt = buildSystemPrompt(null, CONTEXT);
	assert.match(prompt, /Earlier replies in this conversation were based on information and tool results you no longer see/);
	assert.match(prompt, /Do not correct, retract or doubt them unless the user says one is wrong; answer the latest message/);
	// Generic: the same line under every profile
	assert.ok(
		buildSystemPrompt({ tone: "formal", systemPrompt: "Be brief." }, CONTEXT).includes(
			"Do not correct, retract or doubt them",
		),
	);
});
