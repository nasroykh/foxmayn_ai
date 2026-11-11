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
