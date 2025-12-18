import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
	queryRAG,
	queryRAGStream,
	searchChunks,
} from "../../../services/rag.service";
import { ZodTypeProvider } from "fastify-type-provider-zod";

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

export const registerChatRoutes = async (server: FastifyInstance) => {
	// Non-streaming query endpoint
	server.withTypeProvider<ZodTypeProvider>().post(
		"/chat/query",
		{
			schema: {
				body: queryBodySchema,
			},
		},
		async (request) => {
			const { query, options } = request.body;

			const result = await queryRAG(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			return result;
		}
	);

	// Search chunks only (no LLM generation)
	server.withTypeProvider<ZodTypeProvider>().post(
		"/chat/search",
		{
			schema: {
				body: queryBodySchema,
			},
		},
		async (request) => {
			const { query, options } = request.body;

			const results = await searchChunks(query, {
				limit: options?.limit,
				scoreThreshold: options?.scoreThreshold,
				filter: {
					documentId: options?.documentId,
					source: options?.source,
				},
			});

			return { results };
		}
	);

	// Streaming query endpoint using SSE
	server.withTypeProvider<ZodTypeProvider>().post(
		"/chat/query/stream",
		{
			sse: true,
			schema: {
				body: queryBodySchema,
			},
		},
		async (request, reply) => {
			const { query, options } = request.body;

			reply.sse.sendHeaders();

			// Create async generator for SSE
			async function* sseGenerator() {
				try {
					const stream = queryRAGStream(query, {
						limit: options?.limit,
						scoreThreshold: options?.scoreThreshold,
						filter: {
							documentId: options?.documentId,
							source: options?.source,
						},
					});

					for await (const chunk of stream) {
						if (chunk.type === "sources") {
							yield {
								event: "sources",
								data: chunk.data, // @fastify/sse will serialize this
							};
						} else if (chunk.type === "token") {
							yield {
								event: "token",
								data: chunk.data,
							};
						} else if (chunk.type === "done") {
							yield {
								event: "done",
								data: "",
							};
						}
					}
				} catch (error) {
					yield {
						event: "error",
						data: {
							message: error instanceof Error ? error.message : "Unknown error",
						}, // @fastify/sse will serialize this
					};
				}
			}

			// Use @fastify/sse to send the stream
			return reply.sse.send(sseGenerator());
		}
	);
};
