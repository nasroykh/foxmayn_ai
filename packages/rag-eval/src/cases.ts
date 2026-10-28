import { z } from "zod";

/**
 * One evaluation case (one JSONL line). `expected` lists the source URLs that
 * answer the question; `outOfScope` cases have none: a correct answer says it
 * does not know or hands off, and does not invent.
 */
const caseSchema = z
	.object({
		id: z.string().min(1),
		lang: z.string().min(1),
		question: z.string().trim().min(1),
		expected: z.array(z.string().min(1)).default([]),
		options: z
			.object({
				sourcePrefix: z.string().min(1).optional(),
				// Same bounds as the API
				excludeSourcePrefixes: z.array(z.string().min(1).max(512)).max(8).optional(),
				limit: z.number().int().min(1).max(20).optional(),
			})
			.optional(),
		outOfScope: z.boolean().default(false),
	})
	.refine((c) => c.outOfScope || c.expected.length > 0, {
		message: "expected needs at least one source URL unless outOfScope is true",
		path: ["expected"],
	});

export type EvalCase = z.infer<typeof caseSchema>;

/** Parses a JSONL file. Throws with the line number of the first bad case. */
export const parseCases = (text: string): EvalCase[] => {
	const cases: EvalCase[] = [];
	const ids = new Set<string>();
	text.split(/\r?\n/).forEach((line, i) => {
		if (!line.trim()) return;
		let json: unknown;
		try {
			json = JSON.parse(line);
		} catch {
			throw new Error(`Line ${i + 1}: not valid JSON`);
		}
		const parsed = caseSchema.safeParse(json);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			throw new Error(`Line ${i + 1}: ${issue.path.join(".") || "case"}: ${issue.message}`);
		}
		if (ids.has(parsed.data.id)) {
			throw new Error(`Line ${i + 1}: duplicate id ${parsed.data.id}`);
		}
		ids.add(parsed.data.id);
		cases.push(parsed.data);
	});
	if (cases.length === 0) throw new Error("No cases in the file");
	return cases;
};
