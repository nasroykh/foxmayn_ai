import type { CaseResult, LangSummary, Ratio } from "./run";

/** results.json: per-case details, so two runs can be diffed. */
export interface ResultsFile {
	version: 1;
	createdAt: string;
	k: number;
	answers: boolean;
	judgeModel: string | null;
	summary: LangSummary[];
	cases: CaseResult[];
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const rate = (r: Ratio) => (r.den === 0 ? "-" : `${pct(r.num / r.den)} (${r.num}/${r.den})`);

const table = (header: string[], rows: string[][]): string => {
	const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
	const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
	return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
};

/** Per-language metrics; answer columns only when answers were evaluated. */
export const formatSummary = (summary: LangSummary[], k: number, answers: boolean): string => {
	const header = ["lang", "n", "hit@1", "hit@3", `hit@${k}`, "MRR"];
	if (answers) header.push("supported", "citations", "out-of-scope", "tool", "judge err");
	const rows = summary.map((s) => {
		const retrieval =
			s.retrieval.n === 0
				? ["-", "-", "-", "-"]
				: [pct(s.retrieval.hit1), pct(s.retrieval.hit3), pct(s.retrieval.hitK), s.retrieval.mrr.toFixed(2)];
		const row = [s.lang, String(s.n), ...retrieval];
		if (answers) {
			row.push(
				rate(s.supportedYes),
				rate(s.citationsCorrect),
				rate(s.outOfScopePass),
				String(s.tools),
				String(s.judgeErrors),
			);
		}
		return row;
	});
	return table(header, rows);
};

/** Failing case ids with one-line reasons, and tool outcomes. */
export const formatFailures = (cases: CaseResult[]): string => {
	const lines: string[] = [];
	for (const c of cases) {
		for (const reason of c.failures) lines.push(`${c.id} [${c.lang}]: ${reason}`);
		if (c.answer?.outcome === "tool") {
			lines.push(`${c.id} [${c.lang}]: tool outcome (${c.answer.tools.join(", ") || "no name"}), not judged`);
		}
	}
	return lines.length > 0 ? lines.join("\n") : "No failures.";
};

const signed = (value: number, digits: number, unit = "") =>
	`${value > 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;

const ratioValue = (r: Ratio) => (r.den === 0 ? null : r.num / r.den);

/** Metric deltas per language (new - old), then cases that started or stopped failing. */
export const compareRuns = (previous: ResultsFile, current: ResultsFile): string => {
	const out: string[] = [];
	if (previous.k !== current.k) {
		out.push(`Note: k changed from ${previous.k} to ${current.k}; hit@k and MRR are not comparable.`);
	}

	const metrics: [string, (s: LangSummary) => number | null, "pct" | "num"][] = [
		["hit@1", (s) => (s.retrieval.n ? s.retrieval.hit1 : null), "pct"],
		["hit@3", (s) => (s.retrieval.n ? s.retrieval.hit3 : null), "pct"],
		[`hit@k`, (s) => (s.retrieval.n ? s.retrieval.hitK : null), "pct"],
		["MRR", (s) => (s.retrieval.n ? s.retrieval.mrr : null), "num"],
		["supported", (s) => ratioValue(s.supportedYes), "pct"],
		["citations", (s) => ratioValue(s.citationsCorrect), "pct"],
		["out-of-scope", (s) => ratioValue(s.outOfScopePass), "pct"],
	];
	const before = new Map(previous.summary.map((s) => [s.lang, s]));
	const rows: string[][] = [];
	for (const s of current.summary) {
		const old = before.get(s.lang);
		const row = [s.lang];
		for (const [, read, kind] of metrics) {
			const a = old ? read(old) : null;
			const b = read(s);
			row.push(
				a === null || b === null
					? "-"
					: kind === "pct"
						? signed((b - a) * 100, 0, "pt")
						: signed(b - a, 2),
			);
		}
		rows.push(row);
	}
	out.push(table(["lang", ...metrics.map(([name]) => name)], rows));

	const oldCases = new Map(previous.cases.map((c) => [c.id, c]));
	const regressed: string[] = [];
	const fixed: string[] = [];
	for (const c of current.cases) {
		const old = oldCases.get(c.id);
		if (!old) continue;
		if (old.failures.length === 0 && c.failures.length > 0) {
			regressed.push(`${c.id} [${c.lang}]: ${c.failures[0]}`);
		} else if (old.failures.length > 0 && c.failures.length === 0) {
			fixed.push(`${c.id} [${c.lang}]`);
		}
	}
	const added = current.cases.filter((c) => !oldCases.has(c.id)).length;
	const removed = previous.cases.filter((c) => !current.cases.some((n) => n.id === c.id)).length;
	out.push(`\nNow failing (${regressed.length}):${regressed.length ? `\n${regressed.join("\n")}` : " none"}`);
	out.push(`Now passing (${fixed.length}):${fixed.length ? `\n${fixed.join("\n")}` : " none"}`);
	if (added || removed) out.push(`Cases added: ${added}, removed: ${removed}`);
	return out.join("\n");
};
