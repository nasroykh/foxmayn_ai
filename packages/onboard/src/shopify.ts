import { z } from "zod";
import { defaultSleep } from "./http";

const MAX_PAGES = 40;
const PAGE_LIMIT = 250;
const PAGE_DELAY_MS = 1000;
const HEADERS = { "User-Agent": "FoxmaynAI-Onboard/1.0", Accept: "application/json" };

const variantSchema = z.looseObject({
	title: z.string(),
	price: z.string(),
	compare_at_price: z.string().nullish(),
	available: z.boolean().optional(),
});

const productSchema = z.looseObject({
	handle: z.string().min(1),
	title: z.string().min(1),
	body_html: z.string().nullable().optional(),
	vendor: z.string().optional(),
	product_type: z.string().optional(),
	tags: z.union([z.array(z.string()), z.string()]).optional(),
	variants: z.array(variantSchema),
});

export type ShopifyProduct = z.infer<typeof productSchema>;
type Variant = ShopifyProduct["variants"][number];

export interface ShopifyDocument {
	source: string;
	title: string;
	text: string;
	metadata: Record<string, unknown>;
}

// The Latin-1 entity names in code point order, from U+00A0 (nbsp) to U+00FF (yuml)
const LATIN1_ENTITIES =
	"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
		" ",
	);

// Entity names are case-sensitive: Eacute is not eacute
const NAMED_ENTITIES = new Map<string, string>([
	...LATIN1_ENTITIES.map((name, i): [string, string] => [name, String.fromCodePoint(0xa0 + i)]),
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["lsquo", "\u2018"],
	["rsquo", "\u2019"],
	["ldquo", "\u201c"],
	["rdquo", "\u201d"],
	["hellip", "\u2026"],
	["ndash", "\u2013"],
	["mdash", "\u2014"],
	["bull", "\u2022"],
	["euro", "\u20ac"],
	["trade", "\u2122"],
	["oelig", "\u0153"],
	["OElig", "\u0152"],
	["scaron", "\u0161"],
	["Scaron", "\u0160"],
	["Yuml", "\u0178"],
]);

// The only names HTML also defines in capitals
const UPPERCASE_ENTITIES = new Set(["AMP", "LT", "GT", "QUOT", "COPY", "REG"]);

const isSurrogate = (code: number) => code >= 0xd800 && code <= 0xdfff;

const decodeEntities = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
		if (body.startsWith("#")) {
			const hex = body[1] === "x" || body[1] === "X";
			const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			const valid = Number.isFinite(code) && code > 0 && code <= 0x10ffff && !isSurrogate(code);
			return valid ? String.fromCodePoint(code) : match;
		}
		const known = NAMED_ENTITIES.get(body);
		if (known !== undefined) return known;
		return UPPERCASE_ENTITIES.has(body) ? (NAMED_ENTITIES.get(body.toLowerCase()) ?? match) : match;
	});

/** Plain text of an HTML fragment: block tags become newlines, list items get "- ", table cells " : ". */
export const htmlToText = (html: string): string => {
	const text = html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		// A script or style that is never closed runs to the end
		.replace(/<(?:script|style)\b[\s\S]*$/i, "")
		// "<li><p>text": the paragraph must not push the text off the bullet line
		.replace(/(<li\b[^>]*>)\s*<p\b[^>]*>/gi, "$1")
		.replace(/<li\b[^>]*>/gi, "\n- ")
		.replace(/<\/t[dh]\s*>\s*<t[dh]\b[^>]*>/gi, " : ")
		.replace(/<\/?(?:p|br|div|h[1-6]|tr|ul|ol|table|section|article|blockquote|hr)\b[^>]*>/gi, "\n")
		// Only real tags: a bare "<" in the text stays
		.replace(/<\/?[a-z][^>]*>/gi, "");
	return decodeEntities(text)
		.replace(/\u00a0/g, " ")
		.replace(/[ \t\r\f\v]+/g, " ")
		.split("\n")
		.map((line) => line.trim())
		// An empty list item
		.filter((line) => line !== "-")
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		// A list item wrapped in a paragraph leaves a blank line: keep the list tight
		.replace(/(?<=^- [^\n]*)\n\n(?=- )/gm, "\n")
		.trim();
};

const formatPrice = (price: string) => {
	const trimmed = price.trim();
	return trimmed.replace(/\.00$/, "");
};

const tagList = (tags: ShopifyProduct["tags"]): string[] =>
	(Array.isArray(tags) ? tags : (tags ?? "").split(","))
		.map((t) => t.trim())
		.filter((t) => t !== "");

const promotion = (variant: Variant): { compare: string; percent: number } | undefined => {
	if (variant.compare_at_price == null) return undefined;
	const price = Number(variant.price);
	const compare = Number(variant.compare_at_price);
	if (!Number.isFinite(price) || !Number.isFinite(compare) || compare <= price) return undefined;
	return { compare: variant.compare_at_price, percent: Math.round((1 - price / compare) * 100) };
};

const stock = (variant: Variant) =>
	variant.available === undefined ? undefined : variant.available ? "en stock" : "en rupture de stock";

const sameOffer = (a: Variant, b: Variant) =>
	a.price === b.price && (a.compare_at_price ?? null) === (b.compare_at_price ?? null) && a.available === b.available;

/** One product as a text document. The labels are French: the stores served so far are French. */
export const productDocument = (
	product: ShopifyProduct,
	ctx: { store: string; currency?: string; date: string },
): ShopifyDocument => {
	const title = product.title.trim();
	const source = `${ctx.store}/products/${product.handle}`;
	const money = (price: string) => `${formatPrice(price)}${ctx.currency ? ` ${ctx.currency}` : ""}`;
	const family = product.product_type?.trim();
	const vendor = product.vendor?.trim();
	const tags = tagList(product.tags);

	const lines = [`# ${title}`];
	if (vendor) lines.push(`Marque : ${vendor}`);
	if (family) lines.push(`Catégorie : ${family}`);
	if (tags.length > 0) lines.push(`Étiquettes : ${tags.join(", ")}`);

	const [first, ...rest] = product.variants;
	if (first && rest.every((v) => sameOffer(first, v))) {
		lines.push(`Prix : ${money(first.price)}`);
		const promo = promotion(first);
		if (promo && first.compare_at_price != null) {
			const reduction = promo.percent > 0 ? `, réduction de ${promo.percent} %` : "";
			lines.push(`Prix avant promotion : ${money(promo.compare)} (produit en promotion${reduction})`);
		}
		const availability = stock(first);
		if (availability) lines.push(`Disponibilité : ${availability} (relevé le ${ctx.date})`);
		// Same offer for every variant: keep their names (sizes, shades)
		if (rest.length > 0) lines.push(`Variantes : ${product.variants.map((v) => v.title.trim()).join(", ")}`);
	} else if (first) {
		lines.push(`Variantes (relevé le ${ctx.date}) :`);
		for (const variant of product.variants) {
			const parts = [`${variant.title.trim()} : ${money(variant.price)}`];
			const promo = promotion(variant);
			if (promo) parts.push(`avant promotion ${money(promo.compare)}`);
			const availability = stock(variant);
			if (availability) parts.push(availability);
			lines.push(`- ${parts.join(", ")}`);
		}
	}
	lines.push(`Page produit : ${source}`);

	const description = htmlToText(product.body_html ?? "");
	const text = description ? `${lines.join("\n")}\n\n${description}` : lines.join("\n");

	const metadata: Record<string, unknown> = {};
	if (family) metadata.family = family;
	if (vendor) metadata.vendor = vendor;
	metadata.shopifyHandle = product.handle;
	return { source, title, text, metadata };
};

export interface FetchDeps {
	fetch: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
}

/** Reads every product of a public store, and the store currency when meta.json gives one. */
export const fetchShopifyProducts = async (
	store: string,
	deps: FetchDeps,
): Promise<{ products: ShopifyProduct[]; currency?: string }> => {
	const sleep = deps.sleep ?? defaultSleep;
	const products: ShopifyProduct[] = [];
	let firstOfLastPage: string | undefined;
	// One page past the limit, to tell a store of exactly the limit from a larger one
	for (let page = 1; page <= MAX_PAGES + 1; page++) {
		if (page > 1) await sleep(PAGE_DELAY_MS);
		const url = `${store}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
		const response = await deps.fetch(url, { headers: HEADERS });
		if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
		const body: unknown = await response.json().catch(() => undefined);
		const list = body && typeof body === "object" ? (body as { products?: unknown }).products : undefined;
		if (!Array.isArray(list)) throw new Error(`${url}: HTTP ${response.status}: body is not {products: [...]}`);
		if (list.length === 0) break;
		if (page > MAX_PAGES) {
			throw new Error(`${store}: more than ${MAX_PAGES} pages of products, the import would be incomplete`);
		}
		const pageStart = products.length;
		for (const raw of list) {
			const parsed = productSchema.safeParse(raw);
			if (!parsed.success) {
				const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
				throw new Error(`${url}: product ${products.length} is invalid: ${issues.join("; ")}`);
			}
			products.push(parsed.data);
		}
		const firstOfPage = products[pageStart]?.handle;
		if (page > 1 && firstOfPage === firstOfLastPage) {
			throw new Error(`${url}: the store returns the same products on every page`);
		}
		firstOfLastPage = firstOfPage;
	}

	let currency: string | undefined;
	try {
		const response = await deps.fetch(`${store}/meta.json`, { headers: HEADERS });
		if (response.ok) {
			const meta = (await response.json()) as { currency?: unknown };
			if (typeof meta.currency === "string" && meta.currency !== "") currency = meta.currency;
		}
	} catch {
		// The currency is optional
	}
	return { products, currency };
};

/** One document per product of the store. */
export const shopifyDocuments = async (
	store: string,
	deps: FetchDeps & { date: string },
): Promise<ShopifyDocument[]> => {
	const { products, currency } = await fetchShopifyProducts(store, deps);
	const seen = new Set<string>();
	return products.map((product) => {
		const doc = productDocument(product, { store, currency, date: deps.date });
		if (seen.has(doc.source)) throw new Error(`Two products give the same source: ${doc.source}`);
		seen.add(doc.source);
		return doc;
	});
};
