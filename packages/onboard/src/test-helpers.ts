import type { FetchLike } from "./http";
import type { Pack } from "./pack";
import { parsePack } from "./pack";

// Test helpers (no network)

export const json = (body: unknown, status = 200, headers: Headers | Record<string, string> = {}): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: headers instanceof Headers ? headers : { "content-type": "application/json", ...headers },
	});

export interface Call {
	method: string;
	path: string;
	body: Record<string, unknown> | null;
	headers: Record<string, string>;
}

/** A fetch that answers by `METHOD /path` (query included) and records every call. */
export const routerFetch = (routes: Record<string, (call: Call) => Response>) => {
	const calls: Call[] = [];
	const fetch: FetchLike = async (url, init) => {
		const u = new URL(url);
		const call: Call = {
			method: init.method ?? "GET",
			path: u.pathname + u.search,
			body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
			headers: init.headers as Record<string, string>,
		};
		calls.push(call);
		const handler = routes[`${call.method} ${call.path}`] ?? routes[`${call.method} ${u.pathname}`];
		if (!handler) return json({ message: `no mock for ${call.method} ${call.path}` }, 404);
		return handler(call);
	};
	return { fetch, calls };
};

/** A made-up company. */
export const samplePack = (over: Record<string, unknown> = {}): Pack =>
	parsePack(
		JSON.stringify({
			slug: "acme-tools",
			company: { name: "Acme Tools Ltd", website: "https://acme.example" },
			profile: { name: "Acme assistant", tone: "professional" },
			site: { title: "Ask Acme", suggestions: ["Which drill fits concrete?"] },
			hostnames: ["acme.example.com"],
			monthlyCapUsd: 5,
			documents: [
				{ url: "https://acme.example/a.pdf", title: "Drill A", family: "Drills" },
				{ url: "https://acme.example/b.pdf", title: "Saw B" },
			],
			...over,
		}),
	);
