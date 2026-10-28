import { test } from "node:test";
import assert from "node:assert/strict";
import { firstHitRank, normalizeUrl, retrievalScores } from "./metrics";
import { parseCases } from "./cases";

test("normalizeUrl ignores a trailing slash and #fragment only", () => {
	assert.equal(normalizeUrl("https://x.com/a/"), "https://x.com/a");
	assert.equal(normalizeUrl("https://x.com/a#part"), "https://x.com/a");
	assert.equal(normalizeUrl("https://x.com/a/#part"), "https://x.com/a");
	assert.equal(normalizeUrl("https://x.com/"), "https://x.com");
	assert.equal(normalizeUrl(" https://x.com/a "), "https://x.com/a");
	// Everything else is exact
	assert.notEqual(normalizeUrl("https://x.com/A"), normalizeUrl("https://x.com/a"));
	assert.notEqual(normalizeUrl("http://x.com/a"), normalizeUrl("https://x.com/a"));
	assert.equal(normalizeUrl("https://x.com/a?lang=fr"), "https://x.com/a?lang=fr");
});

test("firstHitRank is the 1-based rank of the first expected source", () => {
	const retrieved = ["https://x.com/b", null, "https://x.com/a/", "https://x.com/a#2"];
	assert.equal(firstHitRank(retrieved, ["https://x.com/a"]), 3);
	assert.equal(firstHitRank(retrieved, ["https://x.com/b/", "https://x.com/a"]), 1);
	assert.equal(firstHitRank(retrieved, ["https://x.com/c"]), null);
	assert.equal(firstHitRank([], ["https://x.com/a"]), null);
});

test("hit@k and MRR on hand-made rankings", () => {
	// Ranks of the first expected source for 5 questions, k = 6
	const scores = retrievalScores([1, 2, 4, null, 7], 6);
	assert.equal(scores.n, 5);
	assert.equal(scores.hit1, 1 / 5);
	assert.equal(scores.hit3, 2 / 5);
	assert.equal(scores.hitK, 3 / 5);
	// 1 + 1/2 + 1/4 (rank 7 is past k and counts 0)
	assert.ok(Math.abs(scores.mrr - (1 + 0.5 + 0.25) / 5) < 1e-12);
	assert.deepEqual(retrievalScores([], 6), { n: 0, hit1: 0, hit3: 0, hitK: 0, mrr: 0 });
});

test("parseCases reads JSONL and reports the bad line", () => {
	const cases = parseCases(
		[
			'{"id":"a","lang":"en","question":"Price?","expected":["https://x.com/pricing"],"options":{"sourcePrefix":"https://x.com/en/"}}',
			"",
			'{"id":"b","lang":"ar","question":"Weather?","outOfScope":true}',
		].join("\n"),
	);
	assert.equal(cases.length, 2);
	assert.equal(cases[1].outOfScope, true);
	assert.deepEqual(cases[1].expected, []);
	assert.equal(cases[0].outOfScope, false);

	assert.throws(() => parseCases('{"id":"a","lang":"en","question":"q"}'), /Line 1: expected/);
	assert.throws(() => parseCases('{"id":"a"\n'), /Line 1: not valid JSON/);
	const line = '{"id":"a","lang":"en","question":"q","expected":["u"]}';
	assert.throws(() => parseCases(`${line}\n${line}`), /Line 2: duplicate id a/);
	assert.throws(() => parseCases("\n\n"), /No cases/);
});
