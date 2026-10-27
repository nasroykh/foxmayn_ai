/**
 * Fetch a document from a URL for ingestion.
 *
 * This runs inside the API container, which can reach internal services
 * (Postgres, Redis, Qdrant, ...), so every request is SSRF hardened:
 * https only, public addresses only, the connected IP is the validated IP
 * (no DNS rebinding gap), redirects are followed by hand and re-validated.
 */

import dns from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { ORPCError } from "@orpc/server";
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, isAllowedFileType } from "./file_validation";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "FoxmaynAI-Ingest/1.0";

const blocked = new BlockList();
const blockV4 = (net: string, prefix: number) => blocked.addSubnet(net, prefix, "ipv4");
const blockV6 = (net: string, prefix: number) => blocked.addSubnet(net, prefix, "ipv6");

blockV4("0.0.0.0", 8);
blockV4("10.0.0.0", 8);
blockV4("100.64.0.0", 10);
blockV4("127.0.0.0", 8);
blockV4("169.254.0.0", 16);
blockV4("172.16.0.0", 12);
blockV4("192.0.0.0", 24);
blockV4("192.0.2.0", 24);
blockV4("192.168.0.0", 16);
blockV4("198.18.0.0", 15);
blockV4("198.51.100.0", 24);
blockV4("203.0.113.0", 24);
blockV4("224.0.0.0", 4);
blockV4("240.0.0.0", 4);

// ::/96 covers :: and ::1 and the deprecated IPv4-compatible form
blockV6("::", 96);
blockV6("fc00::", 7);
blockV6("fe80::", 10);
blockV6("ff00::", 8);
blockV6("2001:db8::", 32);
blockV6("100::", 64);
blockV6("64:ff9b::", 96);
blockV6("64:ff9b:1::", 48);
blockV6("::ffff:0:0:0", 96);
// 6to4 and Teredo embed an IPv4 address that could be private
blockV6("2002::", 16);
blockV6("2001::", 32);

// IPv4-mapped spellings the regexes below miss fail closed. Kept out of
// `blocked`: a mapped subnet there would also match plain IPv4 checks.
const mappedV6 = new BlockList();
mappedV6.addSubnet("::ffff:0:0", 96, "ipv6");

// IPv4-mapped IPv6 in the dotted or the hex form (::ffff:7f00:1)
const MAPPED_DOTTED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/**
 * True only for a globally routable IP address.
 * Anything that is not a valid IP, or is private, loopback, link-local,
 * multicast, reserved or documentation space, is false.
 */
export const isPublicAddress = (ip: string): boolean => {
	const family = isIP(ip);
	if (family === 4) return !blocked.check(ip, "ipv4");
	if (family !== 6) return false;

	const dotted = MAPPED_DOTTED.exec(ip);
	if (dotted) return isPublicAddress(dotted[1]);
	const hex = MAPPED_HEX.exec(ip);
	if (hex) {
		const high = parseInt(hex[1], 16);
		const low = parseInt(hex[2], 16);
		return isPublicAddress(
			`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
		);
	}
	if (mappedV6.check(ip, "ipv6")) return false;
	return !blocked.check(ip, "ipv6");
};

const badRequest = (message: string) =>
	new ORPCError("BAD_REQUEST", { message });

/**
 * Validate the shape of a URL before any request: https, no credentials,
 * default port, and a public IP when the host is an IP literal.
 * Hostnames are validated at connection time (see `safeLookup`).
 */
export const validateFetchUrl = (input: string | URL): URL => {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw badRequest("Invalid URL");
	}
	if (url.protocol !== "https:") throw badRequest("URL must use https");
	if (url.username || url.password)
		throw badRequest("URL must not contain credentials");
	// The URL parser drops the default port, so any remaining port is not 443
	if (url.port !== "") throw badRequest("URL must use the default https port");

	// Node skips the custom lookup for IP literals: check them here
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(host) && !isPublicAddress(host))
		throw badRequest("URL resolves to a private address");
	return url;
};

type FetchResult =
	| { kind: "redirect"; location: string }
	| { kind: "file"; contentType: string; body: Buffer };

/** One https request, no redirect following. Resolves on the final headers (and body for 200). */
const requestOnce = (url: URL, signal: AbortSignal): Promise<FetchResult> =>
	new Promise((resolve, reject) => {
		let privateAddress = false;

		// The address checked here is the one the socket connects to
		const lookup = (
			hostname: string,
			options: dns.LookupOptions,
			callback: (...args: unknown[]) => void,
		) => {
			dns.lookup(
				hostname,
				{ all: true, family: options.family },
				(err, addresses) => {
					if (err) return callback(err);
					if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
						privateAddress = true;
						return callback(new Error("URL resolves to a private address"));
					}
					if (options.all) return callback(null, addresses);
					callback(null, addresses[0].address, addresses[0].family);
				},
			);
		};

		const req = request(
			{
				method: "GET",
				hostname: url.hostname.replace(/^\[|\]$/g, ""),
				port: 443,
				path: `${url.pathname}${url.search}`,
				headers: {
					"User-Agent": USER_AGENT,
					Accept: ALLOWED_FILE_TYPES.join(", "),
				},
				lookup: lookup as never,
				agent: false,
				signal,
			},
			(res) => {
				const status = res.statusCode ?? 0;

				if ([301, 302, 303, 307, 308].includes(status)) {
					res.destroy();
					const location = res.headers.location;
					if (!location) return reject(badRequest("Redirect without a location"));
					return resolve({ kind: "redirect", location });
				}
				if (status !== 200) {
					res.destroy();
					return reject(badRequest(`Could not fetch the URL (status ${status})`));
				}

				const encoding = res.headers["content-encoding"];
				if (encoding && encoding.toLowerCase() !== "identity") {
					res.destroy();
					return reject(badRequest("Unsupported content encoding"));
				}

				const contentType = (res.headers["content-type"] ?? "")
					.split(";")[0]
					.trim()
					.toLowerCase();
				if (!contentType) {
					res.destroy();
					return reject(badRequest("URL did not return a content type"));
				}
				if (!isAllowedFileType(contentType)) {
					res.destroy();
					return reject(badRequest("URL content type is not supported"));
				}

				const tooLarge = () => badRequest("File too large (max 10MB)");
				const declared = Number(res.headers["content-length"]);
				if (Number.isFinite(declared) && declared > MAX_FILE_SIZE) {
					res.destroy();
					return reject(tooLarge());
				}

				const chunks: Buffer[] = [];
				let received = 0;
				res.on("data", (chunk: Buffer) => {
					received += chunk.length;
					if (received > MAX_FILE_SIZE) {
						res.destroy();
						return reject(tooLarge());
					}
					chunks.push(chunk);
				});
				res.on("end", () =>
					resolve({ kind: "file", contentType, body: Buffer.concat(chunks) }),
				);
				// Closed before the end: timeout, reset or aborted stream
				res.on("error", () => reject(new Error("stream error")));
				res.on("close", () => {
					if (!res.complete) reject(new Error("connection closed"));
				});
			},
		);

		req.on("error", (err) => {
			if (signal.aborted) return reject(badRequest("Timed out fetching the URL"));
			if (privateAddress) return reject(badRequest("URL resolves to a private address"));
			if ((err as NodeJS.ErrnoException).code === "ENOTFOUND")
				return reject(badRequest("Could not resolve the URL host"));
			reject(badRequest("Could not fetch the URL"));
		});
		req.end();
	});

/** The last path segment of the URL, or its hostname. */
const fileNameFromUrl = (url: URL): string => {
	const last = url.pathname.split("/").filter(Boolean).pop();
	if (last) {
		try {
			return decodeURIComponent(last);
		} catch {
			return last;
		}
	}
	return url.hostname;
};

/**
 * Download a URL into a File, to be validated by `extractTextFromDocument`.
 * Throws BAD_REQUEST with a short, safe message on any failure.
 */
export const fetchUrlAsFile = async (input: string): Promise<File> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		let url = validateFetchUrl(input);
		for (let redirects = 0; ; redirects++) {
			let result: FetchResult;
			try {
				result = await requestOnce(url, controller.signal);
			} catch (err) {
				// A stream failure after the headers carries no ORPCError
				if (err instanceof ORPCError) throw err;
				throw badRequest(
					controller.signal.aborted
						? "Timed out fetching the URL"
						: "Could not fetch the URL",
				);
			}

			if (result.kind === "file") {
				return new File([new Uint8Array(result.body)], fileNameFromUrl(url), {
					type: result.contentType,
				});
			}

			if (redirects >= MAX_REDIRECTS) throw badRequest("Too many redirects");
			let next: URL;
			try {
				next = new URL(result.location, url);
			} catch {
				throw badRequest("Invalid redirect location");
			}
			url = validateFetchUrl(next);
		}
	} finally {
		clearTimeout(timer);
	}
};
