import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { encodingForModel } from "js-tiktoken";

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

// prettier-ignore
export const TIKTOKEN_MODELS=["gpt-4o","gpt-4o-2024-05-13","gpt-4o-2024-08-06","gpt-4o-2024-11-20","gpt-4o-mini-2024-07-18","gpt-4o-mini","o1","o1-2024-12-17","o1-mini","o1-mini-2024-09-12","o1-pro","o1-pro-2025-03-19","o3","o3-2025-04-16","o3-mini","o3-mini-2025-01-31","o4-mini","o4-mini-2025-04-16","chatgpt-4o-latest","gpt-4.1","gpt-4.1-2025-04-14","gpt-4.1-mini","gpt-4.1-mini-2025-04-14","gpt-4.1-nano","gpt-4.1-nano-2025-04-14","gpt-5","gpt-5-2025-08-07","gpt-5-nano","gpt-5-nano-2025-08-07","gpt-5-mini","gpt-5-mini-2025-08-07","gpt-5-chat-latest" ,"text-embedding-ada-002","text-embedding-3-small","text-embedding-3-large"] as const;

/**
 * Calculate token count
 */
export const calculateTokens = (
	text: string,
	encoding: (typeof TIKTOKEN_MODELS)[number],
): number => {
	return encodingForModel(encoding).encode(text).length;
};

/**
 * Split text into chunks using LangChain's RecursiveCharacterTextSplitter
 */
export const chunkText = async (
	text: string,
	options: ChunkOptions = {},
): Promise<Chunk[]> => {
	const {
		chunkSize = 500, // ~500 tokens
		chunkOverlap = 50, // ~50 tokens overlap
		separators = DEFAULT_SEPARATORS,
	} = options;

	const splitter = new RecursiveCharacterTextSplitter({
		chunkSize,
		chunkOverlap,
		separators,
	});

	const textChunks = await splitter.splitText(text);

	return textChunks
		.map((content) => content.trim())
		.filter((content) => content.length > 0)
		.map((content, index) => ({ content, index }));
};

/**
 * Add contextual prefix to chunks for better retrieval
 */
export const addContextualPrefix = (
	chunks: Chunk[],
	documentTitle: string,
	documentSummary?: string,
): Chunk[] => {
	const prefix = documentSummary
		? `Document: ${documentTitle}\nSummary: ${documentSummary}\n\nContent: `
		: `Document: ${documentTitle}\n\nContent: `;

	return chunks.map((chunk) => ({
		...chunk,
		content: prefix + chunk.content,
	}));
};
