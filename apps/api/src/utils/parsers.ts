import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { ORPCError } from "@orpc/server";
import { MAX_PDF_PAGES } from "./file_validation";

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

export const parseHTML = (html: string) => {
	const turndownService = new TurndownService({
		headingStyle: "atx",
		hr: "___",
		codeBlockStyle: "fenced",
		bulletListMarker: "*",
		strongDelimiter: "**",
		emDelimiter: "_",
	});

	return turndownService.turndown(html);
};

export interface PdfPageRenderer {
	/** Page count of the PDF. */
	total: number;
	/** PNG of one page (1-based), rendered on demand so only one image is in memory. */
	render: (page: number) => Promise<Uint8Array>;
	destroy: () => Promise<void>;
}

// Rendered width of a page image: wide enough to read small table text
const PAGE_IMAGE_WIDTH = 1400;

/**
 * Open a PDF to render its pages to PNG one at a time. Page 1 is rendered
 * here, because the library reports the page count only with a render.
 * The caller must call `destroy`.
 */
export const openPdfPageRenderer = async (
	pdfBuffer: Buffer,
): Promise<PdfPageRenderer> => {
	const parser = new PDFParse({ data: pdfBuffer });
	const renderPage = (page: number) =>
		parser.getScreenshot({
			partial: [page],
			desiredWidth: PAGE_IMAGE_WIDTH,
			imageBuffer: true,
			imageDataUrl: false,
		});

	try {
		const first = await renderPage(1);
		let firstPng: Uint8Array | undefined = first.pages[0]?.data;
		return {
			total: first.total,
			render: async (page) => {
				let png: Uint8Array | undefined;
				if (page === 1 && firstPng) {
					png = firstPng;
					firstPng = undefined;
				} else {
					png = (await renderPage(page)).pages[0]?.data;
				}
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
