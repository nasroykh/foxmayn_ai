import { HttpError, defaultSleep, type Client } from "./http";
import type { Pack, PackDocument } from "./pack";

const API = "/api/v1";
const PAGE = 100;
const IMPORT_CONCURRENCY = 3;
export const WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_MS = 10_000;

export interface ExistingDocument {
	id: string;
	source?: string | null;
	status: string;
}

/**
 * Import unless a document with the same source is already indexed.
 * `--reimport` always imports (the API replaces the old one once indexed).
 */
export const shouldImport = (
	doc: Pick<PackDocument, "url">,
	existing: readonly Pick<ExistingDocument, "source" | "status">[],
	reimport: boolean,
): boolean => {
	if (reimport) return true;
	return !existing.some((e) => e.source === doc.url && e.status === "indexed");
};

export interface OnboardOptions {
	client: Client;
	pack: Pack;
	email: string;
	password: string;
	topup?: number;
	reimport?: boolean;
	wait?: boolean;
	log: (line: string) => void;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}

export interface OnboardResult {
	organizationId: string;
	profileId: string;
	imported: number;
	skipped: number;
	failed: number;
	siteFailures: number;
	waitCounts?: Record<string, number>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs the items with at most `limit` in flight. */
const pool = async <T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) => {
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await work(item);
		}
	});
	await Promise.all(runners);
};

const listDocuments = async (client: Client, profileId: string): Promise<ExistingDocument[]> => {
	const all: ExistingDocument[] = [];
	for (let offset = 0; ; offset += PAGE) {
		const body = asRecord(await client.request("GET", `${API}/documents?limit=${PAGE}&offset=${offset}&profileId=${encodeURIComponent(profileId)}`));
		const page = (body.documents ?? []) as ExistingDocument[];
		all.push(...page);
		const total = typeof body.total === "number" ? body.total : all.length;
		if (page.length === 0 || all.length >= total) return all;
	}
};

const findProfile = async (client: Client, name: string) => {
	for (let offset = 0; ; offset += PAGE) {
		const body = asRecord(await client.request("GET", `${API}/profiles?limit=${PAGE}&offset=${offset}`));
		const page = (body.profiles ?? []) as { id: string; name: string }[];
		const match = page.find((p) => p.name === name);
		if (match || page.length < PAGE) return match;
	}
};

export const runOnboard = async (opts: OnboardOptions): Promise<OnboardResult> => {
	const { client, pack, log } = opts;
	const sleep = opts.sleep ?? defaultSleep;
	const now = opts.now ?? Date.now;
	const q = (s: string) => encodeURIComponent(s);

	// 1. Sign in
	await client.request("POST", `${API}/auth/sign-in/email`, {
		email: opts.email,
		password: opts.password,
	});
	log(`sign-in: ok (${opts.email})`);

	// 2. Organization
	const listed = await client.request("GET", `${API}/organizations`);
	const orgs = (Array.isArray(listed) ? listed : (asRecord(listed).organizations ?? [])) as {
		id: string;
		slug: string;
	}[];
	let org = orgs.find((o) => o.slug === pack.slug);
	let orgNote = "found";
	if (!org) {
		org = asRecord(
			await client.request("POST", `${API}/organizations`, { name: pack.company.name, slug: pack.slug }),
		) as { id: string; slug: string };
		if (!org.id) throw new Error("Organization create returned no id");
		orgNote = "created";
	}
	await client.request("POST", `${API}/auth/organization/set-active`, { organizationId: org.id });
	log(`organization: ${orgNote} ${pack.slug} (active)`);

	// 3. Top-up
	if (opts.topup !== undefined) {
		await client.request("POST", `${API}/credits/topup`, {
			organizationId: org.id,
			amount: opts.topup,
			description: `Onboarding top-up of $${opts.topup}`,
		});
		const balance = asRecord(await client.request("GET", `${API}/credits/balance`));
		log(`credits: topped up $${opts.topup}, balance ${String(balance.balance)}`);
	}

	// 4. Cap
	if (pack.monthlyCapUsd !== undefined) {
		await client.request("PATCH", `${API}/credits/cap`, { monthlyCap: pack.monthlyCapUsd });
		log(`cap: ${pack.monthlyCapUsd === null ? "cleared" : `$${pack.monthlyCapUsd} per month`}`);
	}

	// 5. Profile
	const found = await findProfile(client, pack.profile.name);
	let profileId: string;
	if (found) {
		await client.request("PUT", `${API}/profiles/${q(found.id)}`, { data: pack.profile });
		profileId = found.id;
		log(`profile: updated "${pack.profile.name}"`);
	} else {
		const created = asRecord(await client.request("POST", `${API}/profiles`, pack.profile));
		if (typeof created.id !== "string") throw new Error("Profile create returned no id");
		profileId = created.id;
		log(`profile: created "${pack.profile.name}"`);
	}

	// 6. Documents: skip a source already indexed in this profile
	const existing = await listDocuments(client, profileId);
	let imported = 0;
	let skipped = 0;
	let failed = 0;
	const importedIds: string[] = [];
	const failures: string[] = [];
	await pool(pack.documents, IMPORT_CONCURRENCY, async (doc) => {
		if (!shouldImport(doc, existing, opts.reimport ?? false)) {
			skipped++;
			return;
		}
		try {
			const res = asRecord(
				await client.request("POST", `${API}/documents/import`, {
					url: doc.url,
					title: doc.title,
					profileId,
					metadata: { ...(doc.family ? { family: doc.family } : {}), ...doc.metadata },
					replace: true,
				}),
			);
			imported++;
			if (typeof res.documentId === "string") importedIds.push(res.documentId);
		} catch (err) {
			failed++;
			failures.push(`${doc.title}: ${errorText(err)}`);
		}
	});
	log(`documents: imported ${imported}, skipped ${skipped}, failed ${failed}`);
	for (const line of failures) log(`  failed: ${line}`);

	// 7. Public sites
	let siteFailures = 0;
	for (const hostname of pack.hostnames) {
		try {
			await client.request("PUT", `${API}/public-sites/${q(hostname)}`, {
				profileId,
				settings: pack.site ?? {},
				enabled: true,
			});
			log(`public site: ${hostname} enabled`);
		} catch (err) {
			siteFailures++;
			log(`public site: ${hostname} failed: ${errorText(err)}`);
		}
	}

	// 8. Wait for indexing
	let waitCounts: Record<string, number> | undefined;
	if (opts.wait && importedIds.length > 0) {
		const deadline = now() + WAIT_TIMEOUT_MS;
		const state = new Map<string, { status: string; error?: string }>(
			importedIds.map((id) => [id, { status: "pending" }]),
		);
		for (;;) {
			const open = [...state].filter(([, s]) => s.status !== "indexed" && s.status !== "failed");
			await pool(open, IMPORT_CONCURRENCY, async ([id]) => {
				try {
					const doc = asRecord(await client.request("GET", `${API}/documents/${q(id)}`));
					const meta = asRecord(doc.metadata);
					const error = meta.error ?? meta.transcriptionError;
					state.set(id, {
						status: String(doc.status),
						error: typeof error === "string" ? error : undefined,
					});
				} catch (err) {
					if (!(err instanceof HttpError)) throw err;
					// Deleted while indexing: it will never finish
					if (err.status === 404) state.set(id, { status: "failed", error: "document not found" });
					// Any other poll error is not a verdict on the document; try again
				}
			});
			const pending = [...state.values()].filter((s) => s.status !== "indexed" && s.status !== "failed");
			if (pending.length === 0 || now() >= deadline) break;
			await sleep(POLL_MS);
		}
		waitCounts = {};
		for (const s of state.values()) waitCounts[s.status] = (waitCounts[s.status] ?? 0) + 1;
		log(
			`wait: ${Object.entries(waitCounts)
				.map(([k, v]) => `${k} ${v}`)
				.join(", ")}`,
		);
		for (const s of state.values()) if (s.error) log(`  document error: ${s.error}`);
		if ((waitCounts.indexed ?? 0) < state.size && !waitCounts.failed) {
			log("wait: timed out before every document finished");
		}
	}

	return {
		organizationId: org.id,
		profileId,
		imported,
		skipped,
		failed,
		siteFailures,
		waitCounts,
	};
};
