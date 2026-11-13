import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { ORPCError } from "@orpc/server";
import { MAX_PDF_PAGES } from "./file_validation";
import { PageNotRenderableError, planPageImageWidth } from "./transcription";

export const parsePDF = async (pdfBuffer: Buffer) => {
	const parser = new PDFParse({ data: pdfBuffer });

	try {
		// Only parse up to the page cap, then refuse documents that exceed it
		const result = await parser.getText({ first: MAX_PDF_PAGES });
		if (result.total > MAX_PDF_PAGES) {
			throw new ORPCError("BAD_REQUEST", {
				message: `PDF has too many pages (max ${MAX_PDF_PAGES})`,
			});
		}
		return result.pages.map((page) => page.text).join("\n\n");
	} finally {
		await parser.destroy();
	}
};

export const parseDocx = async (docxBuffer: Buffer) => {
	return parseHTML((await mammoth.convertToHtml({ buffer: docxBuffer })).value);
};

/** Page chrome and code: never content worth indexing. */
const NOISE_TAGS = new Set([
	"title",
	"script",
	"style",
	"noscript",
	"template",
	"iframe",
	"svg",
	"canvas",
	"nav",
	"aside",
	"form",
	"button",
]);

/** The part of a DOM node the filter reads (the API has no DOM types). */
interface TreeNode {
	nodeName: string;
	parentNode: TreeNode | null;
}

/**
 * Code, navigation and forms, plus a site header or footer. The header or
 * footer of an article or main block is content and is kept.
 */
const isNoise = (node: TreeNode): boolean => {
	const name = node.nodeName.toLowerCase();
	if (NOISE_TAGS.has(name)) return true;
	if (name !== "header" && name !== "footer") return false;
	for (let p = node.parentNode; p; p = p.parentNode) {
		const parent = p.nodeName.toLowerCase();
		if (parent === "article" || parent === "main") return false;
	}
	return true;
};

const cellText = (content: string) => content.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

const turndownService = new TurndownService({
	headingStyle: "atx",
	hr: "___",
	codeBlockStyle: "fenced",
	bulletListMarker: "*",
	strongDelimiter: "**",
	emDelimiter: "_",
});
// Added rules take precedence over the built-in ones (image, link)
turndownService.addRule("noise", { filter: (node) => isNoise(node), replacement: () => "" });
// Images carry no text, and DOCX images arrive as base64 data URIs
turndownService.addRule("image", { filter: "img", replacement: () => "" });
// Link text only: URLs are noise for retrieval
turndownService.addRule("link", { filter: "a", replacement: (content) => content });
// One table row per line ("| Tension | 220 V |"), so a value stays with its label
turndownService.addRule("tableCell", {
	filter: ["th", "td"],
	replacement: (content) => ` ${cellText(content)} |`,
});
turndownService.addRule("tableRow", {
	filter: "tr",
	replacement: (content) => (/[^\s|]/.test(content) ? `\n|${content}` : ""),
});
turndownService.addRule("table", {
	filter: "table",
	// thead and tbody add blank lines between rows
	replacement: (content) => `\n\n${content.trim().replace(/\n{2,}/g, "\n")}\n\n`,
});

export const parseHTML = (html: string) =>
	turndownService
		.turndown(html)
		.replace(/^[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

export interface PdfPageRenderer {
	/** Page count of the PDF. */
	total: number;
	/**
	 * PNG of one page (1-based), rendered on demand so only one image is in
	 * memory. Throws PageNotRenderableError for a page whose size is not usable.
	 */
	render: (page: number) => Promise<Uint8Array>;
	destroy: () => Promise<void>;
}

/**
 * Open a PDF to render its pages to PNG one at a time. Nothing is rendered
 * here: page 1 is only measured (every page box is checked against the image
 * size budget before it is rendered, see planPageImageWidth). The caller must
 * call `destroy`.
 */
export const openPdfPageRenderer = async (
	pdfBuffer: Buffer,
): Promise<PdfPageRenderer> => {
	const parser = new PDFParse({ data: pdfBuffer });

	// Page size in points at scale 1 (rotation applied), without rendering it
	const measure = async (page: number) => {
		const info = await parser.getInfo({ parsePageInfo: true, partial: [page] });
		const size = info.pages[0];
		if (!size) throw new PageNotRenderableError(`PDF page ${page} not found`);
		return { total: info.total, width: size.width, height: size.height };
	};

	try {
		const first = await measure(1);
		// Refuse before any render, so a bad first page never reaches the canvas
		planPageImageWidth(first.width, first.height);

		return {
			total: first.total,
			render: async (page) => {
				const size = page === 1 ? first : await measure(page);
				const desiredWidth = planPageImageWidth(size.width, size.height);
				const result = await parser.getScreenshot({
					partial: [page],
					desiredWidth,
					imageBuffer: true,
					imageDataUrl: false,
				});
				const png = result.pages[0]?.data;
				if (!png || png.length === 0)
					throw new Error(`Could not render PDF page ${page}`);
				return png;
			},
			destroy: () => parser.destroy(),
		};
	} catch (err) {
		await parser.destroy();
		throw err;
	}
};
