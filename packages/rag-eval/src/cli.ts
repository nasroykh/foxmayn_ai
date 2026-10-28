/**
 * RAG evaluation of a deployed Foxmayn AI, over HTTP only.
 *
 * Run from the repository root:
 *   pnpm rag:eval --file cases.jsonl [--k 6] [--answers] [--judge-model id]
 *                 [--out results.json] [--compare old.json] [--concurrency 2]
 *
 * Env (root .env or the shell): FOXMAYN_AI_URL, FOXMAYN_AI_KEY (a chat-only
 * key is enough), OPENROUTER_API_KEY (judge, with --answers only).
 *
 * Retrieval costs one embedding per case. --answers adds one chat call and
 * one judge call per case.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as dotenv from "dotenv";
import { parseCases } from "./cases";
import { createFoxmaynClient } from "./client";
import { DEFAULT_JUDGE_MODEL, judgeAnswer } from "./judge";
import { compareRuns, formatFailures, formatSummary, type ResultsFile } from "./report";
import { runEval, summarize } from "./run";

dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

// pnpm runs the script in the package folder; paths are the caller's
const fromCaller = (file: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);

const intFlag = (value: string | undefined, name: string, fallback: number, max: number) => {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > max) {
		throw new Error(`--${name} must be an integer from 1 to ${max}`);
	}
	return n;
};

const requireEnv = (name: string): string => {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not set`);
	return value;
};

const main = async () => {
	const { values } = parseArgs({
		options: {
			file: { type: "string" },
			k: { type: "string" },
			answers: { type: "boolean", default: false },
			"judge-model": { type: "string", default: DEFAULT_JUDGE_MODEL },
			out: { type: "string", default: "results.json" },
			compare: { type: "string" },
			concurrency: { type: "string" },
		},
	});
	if (!values.file) throw new Error("--file is required (a JSONL file of cases)");

	// The search route returns at most 20 results
	const k = intFlag(values.k, "k", 6, 20);
	const concurrency = intFlag(values.concurrency, "concurrency", 2, 10);
	const cases = parseCases(readFileSync(fromCaller(values.file), "utf8"));

	const client = createFoxmaynClient({
		baseUrl: requireEnv("FOXMAYN_AI_URL"),
		apiKey: requireEnv("FOXMAYN_AI_KEY"),
		fetch,
	});
	const judgeKey = values.answers ? requireEnv("OPENROUTER_API_KEY") : null;
	const judgeModel = values["judge-model"];

	console.log(
		`${cases.length} cases, k=${k}${values.answers ? `, answers judged by ${judgeModel}` : ", retrieval only"}`,
	);
	const results = await runEval(cases, {
		client,
		k,
		concurrency,
		judge: judgeKey
			? (input) => judgeAnswer({ fetch, apiKey: judgeKey, model: judgeModel, ...input })
			: undefined,
	});

	const summary = summarize(results, k);
	const file: ResultsFile = {
		version: 1,
		createdAt: new Date().toISOString(),
		k,
		answers: values.answers,
		judgeModel: values.answers ? judgeModel : null,
		summary,
		cases: results,
	};
	writeFileSync(fromCaller(values.out), `${JSON.stringify(file, null, 2)}\n`);

	console.log(`\n${formatSummary(summary, k, values.answers)}`);
	console.log(`\n${formatFailures(results)}`);
	if (values.answers) {
		const sum = (pick: (r: (typeof results)[number]) => number) =>
			results.reduce((total, r) => total + pick(r), 0);
		const chatIn = sum((r) => (r.answer?.outcome === "answered" ? (r.answer.usage?.inputTokens ?? 0) : 0));
		const chatOut = sum((r) => (r.answer?.outcome === "answered" ? (r.answer.usage?.outputTokens ?? 0) : 0));
		const judgeIn = sum((r) => (r.judge?.ok ? (r.judge.usage?.inputTokens ?? 0) : 0));
		const judgeOut = sum((r) => (r.judge?.ok ? (r.judge.usage?.outputTokens ?? 0) : 0));
		console.log(`\nTokens: chat ${chatIn} in / ${chatOut} out, judge ${judgeIn} in / ${judgeOut} out`);
	}
	if (values.compare) {
		const previous = JSON.parse(readFileSync(fromCaller(values.compare), "utf8")) as ResultsFile;
		console.log(`\nCompared with ${values.compare}:\n${compareRuns(previous, file)}`);
	}
	console.log(`\nWrote ${values.out}`);
};

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
