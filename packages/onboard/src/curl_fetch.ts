import { execFile } from "node:child_process";

const TIMEOUT_SECONDS = 60;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * GET through the `curl` program, as a `fetch`. Shopify answers Node's own
 * fetch with HTTP 429 on `/products.json` and answers curl normally, so the
 * store is read with curl. Only what the Shopify reader needs: GET, request
 * headers, status and body.
 */
export const curlFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	// -q: no ~/.curlrc. Only http(s), and a redirect only to https
	const args = ["-q", "-sS", "--proto", "=https,http", "--proto-redir", "=https", "--max-time", String(TIMEOUT_SECONDS), "-w", "\n%{http_code}"];
	for (const [name, value] of new Headers(init?.headers)) args.push("-H", `${name}: ${value}`);
	// "--" ends the options: the URL can never be read as one
	args.push("--", url);
	return new Promise((resolve, reject) => {
		execFile("curl", args, { maxBuffer: MAX_BODY_BYTES, encoding: "utf8" }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`curl ${url}: ${stderr.trim() || err.message}`, { cause: err }));
				return;
			}
			const cut = stdout.lastIndexOf("\n");
			const status = Number(stdout.slice(cut + 1));
			if (!Number.isInteger(status) || status < 200 || status > 599) {
				reject(new Error(`curl ${url}: no HTTP status`));
				return;
			}
			resolve(new Response(stdout.slice(0, cut), { status }));
		});
	});
}) as typeof fetch;
