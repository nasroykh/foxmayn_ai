/**
 * Lead onboarding: turns a pack folder into a working demo on a deployed
 * Foxmayn AI, over HTTP only. Safe to run again.
 *
 * Run from the repository root:
 *   pnpm lead:onboard --pack <dir> [--topup <usd>] [--reimport] [--wait] [--dry-run]
 *
 * Env (root .env or the shell): FOXMAYN_AI_URL, the app's own origin (sign-in
 * checks the Origin header against it), FOXMAYN_AI_EMAIL and
 * FOXMAYN_AI_PASSWORD of a global admin (public sites and --topup need one).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as dotenv from "dotenv";
import { createClient } from "./http";
import { parsePack } from "./pack";
import { describePlan, redactor } from "./plan";
import { runOnboard } from "./steps";

dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

// pnpm runs the script in the package folder; paths are the caller's
const fromCaller = (file: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);

const requireEnv = (name: string): string => {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not set`);
	return value;
};

const main = async () => {
	const { values } = parseArgs({
		options: {
			pack: { type: "string" },
			topup: { type: "string" },
			reimport: { type: "boolean", default: false },
			wait: { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
		},
	});
	if (!values.pack) throw new Error("--pack is required (a folder with pack.json)");

	let topup: number | undefined;
	if (values.topup !== undefined) {
		topup = Number(values.topup);
		if (!Number.isFinite(topup) || topup <= 0 || topup > 10000) {
			throw new Error("--topup must be a number above 0 and at most 10000 (USD)");
		}
	}

	const file = path.join(fromCaller(values.pack), "pack.json");
	const pack = parsePack(readFileSync(file, "utf8"));
	console.log(`pack: ${pack.slug}, ${pack.documents.length} documents, ${pack.hostnames.length} hostnames`);

	if (values["dry-run"]) {
		for (const line of describePlan(pack, { topup, reimport: values.reimport, wait: values.wait })) {
			console.log(`dry-run: ${line}`);
		}
		return;
	}

	const baseUrl = requireEnv("FOXMAYN_AI_URL");
	const email = requireEnv("FOXMAYN_AI_EMAIL");
	const password = requireEnv("FOXMAYN_AI_PASSWORD");
	const redact = redactor([password]);

	const result = await runOnboard({
		client: createClient({ baseUrl, fetch }),
		pack,
		email,
		password,
		topup,
		reimport: values.reimport,
		wait: values.wait,
		log: (line) => console.log(redact(line)),
	});
	if (result.failed > 0 || result.siteFailures > 0) process.exitCode = 1;
};

main().catch((err: unknown) => {
	const secret = process.env.FOXMAYN_AI_PASSWORD ?? "";
	console.error(redactor([secret])(err instanceof Error ? err.message : String(err)));
	process.exit(1);
});
