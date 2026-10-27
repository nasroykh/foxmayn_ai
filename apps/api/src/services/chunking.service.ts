import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { encodingForModel, type Tiktoken } from "js-tiktoken";

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

// Building an encoder parses ~200k BPE ranks, so build each one once
const encoders = new Map<string, Tiktoken>();

const getEncoder = (model: (typeof TIKTOKEN_MODELS)[number]): Tiktoken => {
	let encoder = encoders.get(model);
	if (!encoder) {
		encoder = encodingForModel(model);
		encoders.set(model, encoder);
	}
	return encoder;
};

/**
 * Calculate token count
 */
export const calculateTokens = (
	text: string,
	encoding: (typeof TIKTOKEN_MODELS)[number],
): number => {
	return getEncoder(encoding).encode(text).length;
};

/**
 * Token estimate for provider-agnostic billing (gpt-4o tokenizer).
 */
export const estimateTokens = (text: string): number =>
	calculateTokens(text, "gpt-4o");

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
