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
