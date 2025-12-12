import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
	queryRAG,
	queryRAGStream,
	searchChunks,
} from "../../services/rag.service";
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
			const { query, options } = queryBodySchema.parse(request.body);

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
			const { query, options } = queryBodySchema.parse(request.body);

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
			schema: {
				body: queryBodySchema,
			},
		},
		async (request, reply) => {
			const { query, options } = queryBodySchema.parse(request.body);

			// Get allowed origin from CORS config
			const allowedOrigin = process.env.APP_URL || "http://localhost:33460";

			// Set SSE headers with CORS (must be manual since we use raw.writeHead)
			reply.raw.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"Access-Control-Allow-Origin": allowedOrigin,
				"Access-Control-Allow-Credentials": "true",
			});

			const sendEvent = (event: string, data: string) => {
				reply.raw.write(`event: ${event}\n`);
				reply.raw.write(`data: ${data}\n\n`);
			};

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
						sendEvent("sources", JSON.stringify(chunk.data));
					} else if (chunk.type === "token") {
						sendEvent("token", chunk.data);
					} else if (chunk.type === "done") {
						sendEvent("done", "");
					}
				}
			} catch (error) {
				sendEvent(
					"error",
					JSON.stringify({
						message: error instanceof Error ? error.message : "Unknown error",
					})
				);
			} finally {
				reply.raw.end();
			}
		}
	);
};
