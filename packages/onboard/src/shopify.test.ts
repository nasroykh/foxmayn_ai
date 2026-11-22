import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePack } from "./pack";
import { describePlan } from "./plan";
import {
	fetchShopifyProducts,
	htmlToText,
	productDocument,
	shopifyDocuments,
	type ShopifyProduct,
} from "./shopify";
import { runOnboard } from "./steps";
import { createClient } from "./http";
import { json, routerFetch, samplePack } from "./test-helpers";

const ctx = { store: "https://shop.example", currency: "DZD", date: "2026-11-22" };

const product = (over: Record<string, unknown> = {}): ShopifyProduct =>
	({
		handle: "creme-jour",
		title: "  Crème jour  ",
		body_html: "<p>Hydrate la peau.</p>",
		vendor: "Acme",
		product_type: "Soin",
		tags: ["visage", "jour"],
		variants: [{ title: "Default Title", price: "1200.00", compare_at_price: null, available: true }],
		...over,
	}) as ShopifyProduct;

describe("htmlToText", () => {
	it("decodes entities", () => {
		assert.equal(
			htmlToText("Tom &amp; Jerry &lt;b&gt; &quot;x&quot; it&#39;s&apos; a&nbsp;b &#233; &#xE9;"),
			`Tom & Jerry <b> "x" it's' a b é é`,
		);
	});
	it("turns blocks into lines and list items into dashes", () => {
		assert.equal(
			htmlToText("<h2>Titre</h2><p>Un<br>deux</p><ul><li>a</li><li><b>b</b></li></ul><p></p><p></p><p>fin</p>"),
			"Titre\n\nUn\ndeux\n\n- a\n- b\n\nfin",
		);
	});
	it("removes script and style contents", () => {
		assert.equal(htmlToText("a<script>alert(1)</script><style>p{x:y}</style>b"), "ab");
	});
	it("collapses spaces", () => {
		assert.equal(htmlToText("  a    b \t c  "), "a b c");
	});
});

describe("productDocument", () => {
	it("single variant", () => {
		const doc = productDocument(product(), ctx);
		assert.equal(doc.source, "https://shop.example/products/creme-jour");
		assert.equal(doc.title, "Crème jour");
		assert.deepEqual(doc.metadata, { family: "Soin", vendor: "Acme", shopifyHandle: "creme-jour" });
		assert.equal(
			doc.text,
			[
				"# Crème jour",
				"Marque : Acme",
				"Catégorie : Soin",
				"Étiquettes : visage, jour",
				"Prix : 1200 DZD",
				"Disponibilité : en stock (relevé le 2026-11-22)",
				"Page produit : https://shop.example/products/creme-jour",
				"",
				"Hydrate la peau.",
			].join("\n"),
		);
	});
	it("an equal compare_at_price is no promotion", () => {
		const doc = productDocument(
			product({ variants: [{ title: "Default Title", price: "99.50", compare_at_price: "99.50", available: false }] }),
			ctx,
		);
		assert.ok(!doc.text.includes("promotion"));
		assert.match(doc.text, /Prix : 99\.50 DZD/);
		assert.match(doc.text, /en rupture de stock/);
	});
	it("a real promotion gives the percentage", () => {
		const doc = productDocument(
			product({ variants: [{ title: "Default Title", price: "750.00", compare_at_price: "1000.00", available: true }] }),
			ctx,
		);
		assert.match(doc.text, /Prix avant promotion : 1000 DZD \(produit en promotion, réduction de 25 %\)/);
	});
	it("several variants", () => {
		const doc = productDocument(
			product({
				variants: [
					{ title: "30 ml", price: "900.00", compare_at_price: null, available: true },
					{ title: "50 ml", price: "1200.00", compare_at_price: "1500.00", available: false },
				],
			}),
			ctx,
		);
		assert.match(doc.text, /Variantes \(relevé le 2026-11-22\) :\n- 30 ml : 900 DZD, en stock\n- 50 ml : 1200 DZD, avant promotion 1500 DZD, en rupture de stock\n/);
		assert.ok(!doc.text.includes("Prix :"));
	});
	it("an empty description leaves no trailing blank, tags may be a string, no currency", () => {
		const doc = productDocument(
			product({ body_html: null, tags: "a, b,, c", vendor: "", product_type: "" }),
			{ store: ctx.store, date: ctx.date },
		);
		assert.ok(doc.text.endsWith("Page produit : https://shop.example/products/creme-jour"));
		assert.match(doc.text, /Étiquettes : a, b, c\n/);
		assert.match(doc.text, /Prix : 1200\n/);
		assert.ok(!doc.text.includes("Marque"));
		assert.deepEqual(doc.metadata, { shopifyHandle: "creme-jour" });
	});
});

const pageOf = (n: number, count: number) => ({
	products: Array.from({ length: count }, (_, i) => product({ handle: `p-${n}-${i}`, title: `P ${n} ${i}` })),
});

const shopFetch = (meta: () => Response) => {
	const { fetch, calls } = routerFetch({
		"GET /products.json?limit=250&page=1": () => json(pageOf(1, 2)),
		"GET /products.json?limit=250&page=2": () => json(pageOf(2, 1)),
		"GET /products.json?limit=250&page=3": () => json({ products: [] }),
		"GET /meta.json": meta,
	});
	return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
};
const sleeps: number[] = [];
const sleep = async (ms: number) => void sleeps.push(ms);

describe("fetchShopifyProducts", () => {
	it("reads pages until an empty one, then the currency", async () => {
		const { fetch, calls } = shopFetch(() => json({ currency: "DZD" }));
		const out = await fetchShopifyProducts("https://shop.example", { fetch, sleep });
		assert.equal(out.products.length, 3);
		assert.equal(out.currency, "DZD");
		assert.equal(calls.length, 4);
		assert.equal(calls[0]?.headers["User-Agent"], "FoxmaynAI-Onboard/1.0");
		assert.equal(calls[0]?.headers.Accept, "application/json");
		assert.deepEqual(sleeps, [1000, 1000]);
	});
	it("tolerates a meta.json failure", async () => {
		const { fetch } = shopFetch(() => json({}, 404));
		const out = await fetchShopifyProducts("https://shop.example", { fetch, sleep });
		assert.equal(out.products.length, 3);
		assert.equal(out.currency, undefined);
	});
	it("throws on a non-2xx products response, naming URL and status", async () => {
		const { fetch } = routerFetch({ "GET /products.json": () => json({}, 403) });
		await assert.rejects(
			() => fetchShopifyProducts("https://shop.example", { fetch: fetch as unknown as typeof globalThis.fetch, sleep }),
			/https:\/\/shop\.example\/products\.json\?limit=250&page=1: HTTP 403/,
		);
	});
	it("throws on a body without products", async () => {
		const { fetch } = routerFetch({ "GET /products.json": () => json({ nope: 1 }) });
		await assert.rejects(
			() => fetchShopifyProducts("https://shop.example", { fetch: fetch as unknown as typeof globalThis.fetch, sleep }),
			/HTTP 200/,
		);
	});
	it("throws on an invalid product with its index", async () => {
		const { fetch } = routerFetch({
			"GET /products.json": () => json({ products: [product(), { handle: "x", title: "X", variants: [{ title: "v" }] }] }),
		});
		await assert.rejects(
			() => fetchShopifyProducts("https://shop.example", { fetch: fetch as unknown as typeof globalThis.fetch, sleep }),
			/product 1 is invalid/,
		);
	});
});

describe("shopifyDocuments", () => {
	it("builds one document per product", async () => {
		const { fetch } = shopFetch(() => json({ currency: "DZD" }));
		const docs = await shopifyDocuments("https://shop.example", { fetch, sleep, date: "2026-11-22" });
		assert.equal(docs.length, 3);
		assert.match(docs[0]?.text ?? "", /Prix : 1200 DZD/);
	});
	it("throws on a duplicate source", async () => {
		const { fetch } = routerFetch({
			"GET /products.json?limit=250&page=1": () => json({ products: [product(), product()] }),
			"GET /products.json?limit=250&page=2": () => json({ products: [] }),
		});
		await assert.rejects(
			() => shopifyDocuments("https://shop.example", { fetch: fetch as unknown as typeof globalThis.fetch, sleep, date: "2026-11-22" }),
			/same source/,
		);
	});
});

describe("pack shopify", () => {
	const withStore = (store: unknown) => () =>
		parsePack(
			JSON.stringify({
				slug: "acme",
				company: { name: "Acme" },
				profile: { name: "A" },
				shopify: { store },
			}),
		);
	it("accepts an origin and normalises it", () => {
		assert.equal(withStore("https://shop.example/")().shopify?.store, "https://shop.example");
		assert.equal(withStore("https://shop.example")().shopify?.store, "https://shop.example");
	});
	it("rejects a path, query, hash and http", () => {
		assert.throws(withStore("https://shop.example/collections"), /shopify\.store/);
		assert.throws(withStore("https://shop.example/?a=1"), /shopify\.store/);
		assert.throws(withStore("https://shop.example/#x"), /shopify\.store/);
		assert.throws(withStore("http://shop.example"), /https/);
	});
});

describe("plan", () => {
	it("mentions the store", () => {
		const pack = samplePack({ shopify: { store: "https://shop.example" } });
		assert.ok(
			describePlan(pack, {}).includes("shopify: one document per product of https://shop.example (fetched at run time; --reimport refreshes prices and stock)"),
		);
		assert.ok(!describePlan(samplePack(), {}).some((l) => l.startsWith("shopify")));
	});
});

describe("runOnboard with text documents", () => {
	const doc = productDocument(product(), ctx);
	const run = async (documents: unknown[], reimport = false) => {
		const logs: string[] = [];
		const { fetch, calls } = routerFetch({
			"POST /api/v1/auth/sign-in/email": () => json({}),
			"GET /api/v1/organizations": () => json([{ id: "o", slug: "acme-tools" }]),
			"POST /api/v1/auth/organization/set-active": () => json({}),
			"PATCH /api/v1/credits/cap": () => json({}),
			"GET /api/v1/profiles": () => json({ profiles: [] }),
			"POST /api/v1/profiles": () => json({ id: "p" }),
			"GET /api/v1/documents": () => json({ documents, total: documents.length }),
			"POST /api/v1/documents/import": () => json({ documentId: "d" }),
			"PUT /api/v1/public-sites/acme.example.com": () => json({}),
		});
		const result = await runOnboard({
			client: createClient({ baseUrl: "https://demo.example", fetch, retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} } }),
			pack: samplePack({ documents: [] }),
			email: "a@b.c",
			password: "pw",
			textDocuments: [doc],
			reimport,
			log: (l) => logs.push(l),
		});
		return { result, logs, calls };
	};
	it("sends text and source", async () => {
		const { result, calls } = await run([]);
		assert.equal(result.imported, 1);
		const body = calls.find((c) => c.path === "/api/v1/documents/import")?.body;
		assert.deepEqual(body, {
			text: doc.text,
			source: doc.source,
			title: "Crème jour",
			profileId: "p",
			metadata: doc.metadata,
			replace: true,
		});
	});
	it("skips an indexed source and re-imports with reimport", async () => {
		const existing = [{ id: "d1", source: doc.source, status: "indexed" }];
		assert.equal((await run(existing)).result.skipped, 1);
		const again = await run(existing, true);
		assert.equal(again.result.skipped, 0);
		assert.equal(again.result.imported, 1);
	});
});

describe("review fixes", () => {
	const variant = { title: "Default Title", price: "100.00", compare_at_price: null, available: true };
	const ctx = { store: "https://shop.example", currency: "DZD", date: "2026-11-22" };

	it("decodes French named entities, case-sensitive, and rejects surrogates", () => {
		assert.equal(htmlToText("&Eacute;t&eacute; &laquo;&nbsp;l&rsquo;&oelig;il&nbsp;&raquo;&hellip; &#xD800; &inconnu;"), "Été « l’œil »… &#xD800; &inconnu;");
	});

	it("separates table cells and keeps a bare <", () => {
		assert.equal(htmlToText("<table><tr><td>Taille</td><td>40 cm</td></tr><tr><th>Poids</th><td>3 &lt; 5 kg</td></tr></table>3 < 5 et 6 > 4"), "Taille : 40 cm\n\nPoids : 3 < 5 kg\n\n3 < 5 et 6 > 4");
	});

	it("keeps a paragraph inside a list item on the bullet line, and drops empty items", () => {
		assert.equal(htmlToText("<ul><li><p>a</p></li><li></li><li><p>b</p></li></ul>"), "- a\n- b");
	});

	it("leaves invalid capital entity names as typed", () => {
		assert.equal(htmlToText("&EACUTE; &AMP; &Yuml; &ETH;"), "&EACUTE; & \u0178 \u00d0");
	});

	it("drops an unclosed script", () => {
		assert.equal(htmlToText("<p>Texte</p><script>var a = 1;"), "Texte");
	});

	it("names the variants that share one offer", () => {
		const doc = productDocument(
			{ handle: "t", title: "T", variants: [{ ...variant, title: "S" }, { ...variant, title: "M" }] },
			ctx,
		);
		assert.match(doc.text, /^Prix : 100 DZD$/m);
		assert.match(doc.text, /^Variantes : S, M$/m);
	});

	it("gives no percentage for a discount that rounds to zero", () => {
		const doc = productDocument(
			{ handle: "t", title: "T", variants: [{ ...variant, price: "99.90", compare_at_price: "100.00" }] },
			ctx,
		);
		assert.match(doc.text, /^Prix avant promotion : 100 DZD \(produit en promotion\)$/m);
	});

	const page = (handles: string[]) =>
		new Response(JSON.stringify({ products: handles.map((handle) => ({ handle, title: handle, variants: [variant] })) }));
	const sleep = async () => {};

	it("fails when the store repeats the same page", async () => {
		const fetch = (async () => page(["a", "b"])) as unknown as typeof globalThis.fetch;
		await assert.rejects(() => fetchShopifyProducts("https://shop.example", { fetch, sleep }), /same products on every page/);
	});

	it("fails instead of truncating a store past the page cap", async () => {
		let n = 0;
		const fetch = (async () => page([`p${n++}`])) as unknown as typeof globalThis.fetch;
		await assert.rejects(() => fetchShopifyProducts("https://shop.example", { fetch, sleep }), /more than 40 pages of products/);
		assert.equal(n, 41);
	});

	it("rejects a store URL with a user", () => {
		assert.throws(
			() => parsePack(JSON.stringify({ slug: "s", company: { name: "C" }, profile: { name: "P" }, shopify: { store: "https://user:pw@shop.example/" } })),
			/shopify\.store/,
		);
	});
});
