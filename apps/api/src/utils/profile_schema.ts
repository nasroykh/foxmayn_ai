import { z } from "zod";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import {
	DEFAULT_CHAT_MODEL,
	isListedChatModel,
} from "../services/model-catalog.service";

/**
 * Bounds for the user-editable RAG profile settings. These are spread over the
 * drizzle-zod insert/update schemas, so every field stays optional (the DB
 * supplies defaults) while out-of-range values are rejected.
 */

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_CHUNK_OVERLAP = 50;

const embeddingModelIds = OPENROUTER_EMBEDDING_MODELS.map((m) => m.id) as [
	string,
	...string[],
];

export const PROFILE_TONES = [
	"casual",
	"professional",
	"friendly",
	"formal",
] as const;
export const PROFILE_RESPONSE_LENGTHS = [
	"concise",
	"balanced",
	"detailed",
] as const;
export const PROFILE_REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

// Reasoning effort of a new profile that does not choose one
export const DEFAULT_REASONING_EFFORT: (typeof PROFILE_REASONING_EFFORTS)[number] =
	"low";

/**
 * Values a new profile gets when the caller leaves them out. Set here, not as
 * column defaults, so the defaults can change without a migration.
 */
export const withProfileDefaults = <
	T extends { model?: string | null; reasoningEffort?: string | null },
>(
	data: T,
): T & { model: string; reasoningEffort: string } => ({
	...data,
	model: data.model ?? DEFAULT_CHAT_MODEL,
	reasoningEffort: data.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
});

export const profileSettingsShape = {
	name: z.string().trim().min(1).max(100).optional(),
	description: z.string().max(1000).nullish(),

	// Document processing
	embeddingModel: z.enum(embeddingModelIds).optional(),
	chunkSize: z.number().int().min(100).max(4000).optional(),
	chunkOverlap: z.number().int().min(0).max(3999).optional(),
	separators: z.array(z.string().max(20)).max(20).optional(),

	// Retrieval
	scoreThreshold: z.number().min(0).max(1).optional(),
	topK: z.number().int().min(1).max(50).optional(),

	// Generation
	// Checked against the model list with isAcceptableModelChange
	model: z.string().trim().min(1).max(200).optional(),
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().min(0).max(1).optional(),
	maxTokens: z.number().int().min(1).max(32000).optional(),
	reasoningEffort: z.enum(PROFILE_REASONING_EFFORTS).optional(),

	// Personality
	assistantName: z.string().trim().min(1).max(100).optional(),
	companyName: z.string().max(200).nullish(),
	domain: z.string().max(200).nullish(),
	tone: z.enum(PROFILE_TONES).optional(),
	responseLength: z.enum(PROFILE_RESPONSE_LENGTHS).optional(),
	language: z.string().trim().min(1).max(50).optional(),
	systemPrompt: z.string().max(8000).nullish(),
	customInstructions: z.array(z.string().max(500)).max(20).optional(),
};

/**
 * A profile may newly choose only a model OpenRouter lists now. Keeping the
 * stored model is always allowed, so a delisted model never blocks other edits.
 */
export const isAcceptableModelChange = (
	model: string | undefined,
	storedModel?: string,
): boolean =>
	model === undefined || model === storedModel || isListedChatModel(model);

/** Overlap must leave room for new text in every chunk. */
export const isValidChunkOverlap = (
	chunkSize: number,
	chunkOverlap: number,
): boolean => chunkOverlap < chunkSize;
