import { withTimeout } from "../config/timeout";

export type CheckResult = { ok: boolean; ms: number; error?: string };

export type ReadinessReport = {
	status: "ready" | "unavailable";
	checks: Record<string, CheckResult>;
};

/**
 * Run dependency checks in parallel, each bounded by `timeoutMs`.
 * Error details are logged, not returned, so the public endpoint leaks nothing.
 */
export const runReadinessChecks = async (
	checks: Record<string, () => Promise<unknown>>,
	timeoutMs: number,
): Promise<ReadinessReport> => {
	const entries = await Promise.all(
		Object.entries(checks).map(async ([name, check]): Promise<[string, CheckResult]> => {
			const startedAt = Date.now();
			try {
				await withTimeout(check(), timeoutMs, name);
				return [name, { ok: true, ms: Date.now() - startedAt }];
			} catch (error) {
				console.error(
					`[health] ${name} check failed:`,
					error instanceof Error ? error.message : error,
				);
				return [
					name,
					{ ok: false, ms: Date.now() - startedAt, error: "unavailable" },
				];
			}
		}),
	);

	const results = Object.fromEntries(entries);
	const ready = entries.every(([, result]) => result.ok);
	return { status: ready ? "ready" : "unavailable", checks: results };
};
