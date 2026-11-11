import type { Pack } from "./pack";

/** Replaces every secret in a log line. */
export const redactor = (secrets: readonly string[]) => {
	const list = secrets.filter((s) => s.length > 0);
	return (line: string) => list.reduce((out, s) => out.split(s).join("[redacted]"), line);
};

/** What a run would do, one line per step. No requests. */
export const describePlan = (
	pack: Pack,
	opts: { topup?: number; reimport?: boolean; wait?: boolean },
): string[] => {
	const lines = [
		`organization: find or create "${pack.slug}" (${pack.company.name}) and make it active`,
	];
	if (opts.topup !== undefined) lines.push(`credits: top up $${opts.topup} (global admin only)`);
	if (pack.monthlyCapUsd !== undefined) {
		lines.push(`cap: ${pack.monthlyCapUsd === null ? "clear" : `$${pack.monthlyCapUsd} per month`}`);
	}
	lines.push(`profile: create or update "${pack.profile.name}"`);
	lines.push(
		`documents: ${pack.documents.length} in pack, ${opts.reimport ? "all re-imported" : "indexed ones with the same source skipped"}`,
	);
	for (const host of pack.hostnames) lines.push(`public site: ${host}`);
	if (opts.wait) lines.push("wait: until every imported document is indexed or failed (30 min limit)");
	return lines;
};
