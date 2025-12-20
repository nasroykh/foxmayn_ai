import { z } from "zod";
import {
	queryRAG,
	queryRAGStream,
	searchChunks,
} from "../../services/rag.service";
import { authProcedure } from "../middleware";
import { env } from "../../config/env";
import { OPENROUTER_AI_MODELS } from "../../utils/openrouter";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// Request schemas
const queryBodySchema = z.object({
	query: z.string().min(1).max(10000),
	options: z
		.object({
			limit: z.number().min(1).max(20).optional(),
			scoreThreshold: z.number().min(0).max(1).optional(),
			documentId: z.string().optional(),
			source: z.string().optional(),
		})
		.optional(),
});

export const chatRoutes = {
	query: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query`,
			description: "Non-streaming query endpoint",
		})
		.input(queryBodySchema)
		.handler(async ({ input }) => {
			const { query, options } = input;

			const result = await queryRAG(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			return result;
		}),

	search: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/search`,
			description: "Search chunks only (no LLM generation)",
		})
		.input(queryBodySchema)
		.handler(async ({ input }) => {
			const { query, options } = input;

			const results = await searchChunks(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			return { results };
		}),

	queryStream: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/chat/query/stream`,
			description: "Streaming query endpoint",
		})
		.input(queryBodySchema)
		.handler(async function* ({ input }) {
			const { query, options } = input;

			const stream = queryRAGStream(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			for await (const chunk of stream) {
				yield chunk;
			}
		}),
	getModels: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/chat/models`,
			description: "Get available models",
		})
		.output(z.object({ models: z.array(z.string()) }))
		.handler(async () => {
			return {
				models: Object.values(OPENROUTER_AI_MODELS),
			};
		}),
};
