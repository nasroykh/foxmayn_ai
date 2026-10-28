import type { EvalCase } from "./cases";
import type { FoxmaynClient, Passage, Usage } from "./client";
import type { JudgeResult } from "./judge";
import { firstHitRank, normalizeUrl, retrievalScores, type RetrievalScores } from "./metrics";

export type AnswerOutcome =
	| { outcome: "answered"; text: string; sources: (string | null)[]; usage?: Usage }
	| { outcome: "tool"; tools: string[] }
	| { outcome: "error"; error: string };

export interface CaseResult {
	id: string;
	lang: string;
	question: string;
	outOfScope: boolean;
	// In-scope cases only
	retrieval?: { rank: number | null; sources: (string | null)[]; error?: string };
	answer?: AnswerOutcome;
	judge?: JudgeResult;
	// One line each; empty when the case passed everything it was checked on
	failures: string[];
}

export interface EvalDeps {
	client: FoxmaynClient;
	// Set with --answers
	judge?: (input: { question: string; answer: string; sources: Passage[] }) => Promise<JudgeResult>;
	k: number;
	concurrency: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Out-of-scope pass: the answer declines or hands off (the judge reports answered=false). */
export const outOfScopePassed = (judge: JudgeResult): boolean => judge.ok && !judge.verdict.answered;

const evaluateCase = async (c: EvalCase, deps: EvalDeps): Promise<CaseResult> => {
	const result: CaseResult = {
		id: c.id,
		lang: c.lang,
		question: c.question,
		outOfScope: c.outOfScope,
		failures: [],
	};
	const scope = {
		sourcePrefix: c.options?.sourcePrefix,
		excludeSourcePrefixes: c.options?.excludeSourcePrefixes,
	};
	const options = { ...scope, limit: c.options?.limit ?? deps.k };

	// 1. Retrieval
	if (!c.outOfScope) {
		try {
			const passages = await deps.client.search(c.question, options);
			const sources = passages.map((p) => p.source);
			const rank = firstHitRank(sources, c.expected);
			result.retrieval = { rank, sources };
			if (rank === null || rank > deps.k) {
				const top = sources[0] ? normalizeUrl(sources[0]) : "nothing";
				result.failures.push(`retrieval: no expected source in top ${deps.k} (top: ${top})`);
			}
		} catch (err) {
			result.retrieval = { rank: null, sources: [], error: message(err) };
			result.failures.push(`retrieval: search failed: ${message(err)}`);
		}
	}

	if (!deps.judge) return result;

	// 2. Answer
	let response;
	try {
		response = await deps.client.query(c.question, { ...scope, limit: c.options?.limit });
	} catch (err) {
		result.answer = { outcome: "error", error: message(err) };
		result.failures.push(`answer: ${message(err)}`);
		return result;
	}
	if (response.finishReason === "tool_calls") {
		// A tool turn is not an answer: recorded, not judged
		result.answer = { outcome: "tool", tools: (response.toolCalls ?? []).map((t) => t.name) };
		return result;
	}
	result.answer = {
		outcome: "answered",
		text: response.answer,
		sources: response.sources.map((s) => s.source),
		usage: response.usage,
	};

	// 3. Judge
	const judge = await deps.judge({
		question: c.question,
		answer: response.answer,
		sources: response.sources,
	});
	result.judge = judge;
	if (!judge.ok) {
		result.failures.push(`judge_error: ${judge.detail}`);
		return result;
	}
	const { verdict } = judge;
	const notes = verdict.notes ? ` (${verdict.notes})` : "";
	if (c.outOfScope) {
		if (!outOfScopePassed(judge)) {
			result.failures.push(`out of scope: answered instead of declining${notes}`);
		}
		return result;
	}
	if (!verdict.answered) result.failures.push(`not answered${notes}`);
	if (verdict.supported !== "yes") result.failures.push(`supported: ${verdict.supported}${notes}`);
	if (!verdict.citationsCorrect) result.failures.push(`citations wrong${notes}`);
	return result;
};

/** Runs every case, at most `concurrency` at a time, in input order. */
export const runEval = async (cases: EvalCase[], deps: EvalDeps): Promise<CaseResult[]> => {
	const results: CaseResult[] = new Array(cases.length);
	let next = 0;
	const worker = async () => {
		while (next < cases.length) {
			const i = next++;
			results[i] = await evaluateCase(cases[i], deps);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, deps.concurrency) }, worker));
	return results;
};

export interface Ratio {
	num: number;
	den: number;
}

export interface LangSummary {
	lang: string;
	n: number;
	retrieval: RetrievalScores;
	supportedYes: Ratio;
	citationsCorrect: Ratio;
	outOfScopePass: Ratio;
	tools: number;
	judgeErrors: number;
	answerErrors: number;
}

const ratio = (items: boolean[]): Ratio => ({
	num: items.filter(Boolean).length,
	den: items.length,
});

const summarizeGroup = (lang: string, results: CaseResult[], k: number): LangSummary => {
	const inScope = results.filter((r) => !r.outOfScope);
	const judged = (rs: CaseResult[]) =>
		rs.flatMap((r) => (r.judge?.ok ? [r.judge.verdict] : []));
	return {
		lang,
		n: results.length,
		retrieval: retrievalScores(
			inScope.map((r) => r.retrieval?.rank ?? null),
			k,
		),
		supportedYes: ratio(judged(inScope).map((v) => v.supported === "yes")),
		citationsCorrect: ratio(judged(inScope).map((v) => v.citationsCorrect)),
		outOfScopePass: ratio(
			results
				.filter((r) => r.outOfScope && r.judge)
				.map((r) => outOfScopePassed(r.judge!)),
		),
		tools: results.filter((r) => r.answer?.outcome === "tool").length,
		judgeErrors: results.filter((r) => r.judge && !r.judge.ok).length,
		answerErrors: results.filter((r) => r.answer?.outcome === "error").length,
	};
};

/** One summary per language (sorted), then "all". */
export const summarize = (results: CaseResult[], k: number): LangSummary[] => {
	const langs = [...new Set(results.map((r) => r.lang))].sort();
	return [
		...langs.map((lang) =>
			summarizeGroup(
				lang,
				results.filter((r) => r.lang === lang),
				k,
			),
		),
		summarizeGroup("all", results, k),
	];
};
