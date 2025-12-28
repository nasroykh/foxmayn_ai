import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import TurndownService from "turndown";
import xlsx from "xlsx";

export const parsePDF = async (pdfBuffer: Buffer) => {
	const parser = new PDFParse({ data: pdfBuffer });

	const result = await parser.getText();

	parser.destroy();
	return result.pages.map((page) => page.text).join("\n\n");
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

export const parseXlsx = (xlsxBuffer: Buffer) => {
	const workbook = xlsx.read(xlsxBuffer, { type: "buffer" });
	let fullText = "";

	for (let i = 0; i < workbook.SheetNames.length; i++) {
		const sheetName = workbook.SheetNames[i];
		const sheet = workbook.Sheets[sheetName];
		const csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false });
		fullText += `### Sheet: ${sheetName}\n${csv}\n\n`;
	}

	return fullText.trim();
};
