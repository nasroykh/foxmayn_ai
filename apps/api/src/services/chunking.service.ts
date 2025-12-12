import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getEncoding } from "js-tiktoken";

/**
 * Text chunking service using LangChain's RecursiveCharacterTextSplitter
 * Recommended: 400-512 tokens with 10-20% overlap
 */

export interface ChunkOptions {
	chunkSize?: number; // in characters
	chunkOverlap?: number; // in characters
	separators?: string[];
}

export interface Chunk {
	content: string;
	index: number;
}

const DEFAULT_SEPARATORS = [
	"\n\n",
	"\n",
	". ",
	"! ",
	"? ",
	"; ",
	", ",
	" ",
	"",
];

/**
 * Calculate token count
 */
export const calculateTokens = (text: string): number => {
	const encoding = getEncoding("o200k_base");
	return encoding.encode(text).length;
};

/**
 * Split text into chunks using LangChain's RecursiveCharacterTextSplitter
 */
export const chunkText = async (
	text: string,
	options: ChunkOptions = {}
): Promise<Chunk[]> => {
	const {
		chunkSize = 1000, // ~500 tokens
		chunkOverlap = 100, // ~50 tokens overlap
		separators = DEFAULT_SEPARATORS,
	} = options;

	const splitter = new RecursiveCharacterTextSplitter({
		chunkSize,
		chunkOverlap,
		separators,
	});

	const textChunks = await splitter.splitText(text);

	return textChunks
		.map((content, index) => content.trim())
		.filter((content) => content.length > 0)
		.map((content, index) => ({ content, index }));
};

/**
 * Add contextual prefix to chunks for better retrieval
 */
export const addContextualPrefix = (
	chunks: Chunk[],
	documentTitle: string,
	documentSummary?: string
): Chunk[] => {
	const prefix = documentSummary
		? `Document: ${documentTitle}\nSummary: ${documentSummary}\n\nContent: `
		: `Document: ${documentTitle}\n\nContent: `;

	return chunks.map((chunk) => ({
		...chunk,
		content: prefix + chunk.content,
	}));
};
