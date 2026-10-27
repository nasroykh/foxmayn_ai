import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import TurndownService from "turndown";

export const parsePDF = async (pdfBuffer: Buffer) => {
	const parser = new PDFParse({ data: pdfBuffer });

	try {
		const result = await parser.getText();
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
