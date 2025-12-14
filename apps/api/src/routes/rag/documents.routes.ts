import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
	indexDocument,
	getDocument,
	listDocuments,
	deleteDocument,
} from "../../services/rag.service";
import { ZodTypeProvider } from "fastify-type-provider-zod";

const ALLOWED_TEXT_EXTENSIONS = [
	".txt",
	".md",
	".csv",
	".json",
	".xml",
	".html",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Request schemas
const createDocumentSchema = z.object({
	title: z.string().min(1).max(500),
	content: z.string().min(1),
	source: z.string().max(1000).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

const documentIdParamsSchema = z.object({
	id: z.string(),
});

const listQuerySchema = z.object({
	limit: z.coerce.number().min(1).max(100).optional(),
	offset: z.coerce.number().min(0).optional(),
});

export const registerDocumentRoutes = async (server: FastifyInstance) => {
	// Create and index a document
	server.withTypeProvider<ZodTypeProvider>().post(
		"/documents",
		{
			schema: {
				body: createDocumentSchema,
				response: {
					201: z.object({
						id: z.string(),
						message: z.string(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { title, content, source, metadata } = request.body;

			const documentId = await indexDocument({
				title,
				content,
				source,
				metadata,
			});

			return reply.status(201).send({
				id: documentId,
				message: "Document indexed successfully",
			});
		}
	);

	// Upload a text file and index as document
	server.post(
		"/documents/upload",
		{
			schema: {
				consumes: ["multipart/form-data"],
				response: {
					201: z.object({
						id: z.string(),
						message: z.string(),
					}),
					400: z.object({
						error: z.string(),
					}),
				},
			},
		},
		async (request, reply) => {
			const data = await request.file();

			if (!data) {
				return reply.status(400).send({ error: "No file uploaded" });
			}

			// Validate file extension
			const filename = data.filename.toLowerCase();
			const hasValidExtension = ALLOWED_TEXT_EXTENSIONS.some((ext) =>
				filename.endsWith(ext)
			);

			if (!hasValidExtension) {
				return reply.status(400).send({
					error: `Invalid file type. Allowed: ${ALLOWED_TEXT_EXTENSIONS.join(
						", "
					)}`,
				});
			}

			// Read file content
			const chunks: Buffer[] = [];
			for await (const chunk of data.file) {
				chunks.push(chunk);
			}
			const buffer = Buffer.concat(chunks);

			if (buffer.length > MAX_FILE_SIZE) {
				return reply.status(400).send({ error: "File too large (max 10MB)" });
			}

			const content = buffer.toString("utf-8");

			if (!content.trim()) {
				return reply.status(400).send({ error: "File is empty" });
			}

			// Parse form fields
			const fields = data.fields;
			const title =
				(fields.title as { value?: string })?.value || data.filename;
			const source = (fields.source as { value?: string })?.value;
			const metadataRaw = (fields.metadata as { value?: string })?.value;

			let metadata: Record<string, unknown> | undefined;
			if (metadataRaw) {
				try {
					metadata = JSON.parse(metadataRaw);
				} catch {
					return reply.status(400).send({ error: "Invalid metadata JSON" });
				}
			}

			const documentId = await indexDocument({
				title,
				content,
				source,
				metadata,
			});

			return reply.status(201).send({
				id: documentId,
				message: "File uploaded and indexed successfully",
			});
		}
	);

	// Get document by ID
	server.withTypeProvider<ZodTypeProvider>().get(
		"/documents/:id",
		{
			schema: {
				params: documentIdParamsSchema,
			},
		},
		async (request, reply) => {
			const { id } = request.params;

			const doc = await getDocument(id);

			if (!doc) {
				return reply.status(404).send({ error: "Document not found" });
			}

			return {
				id: doc.id,
				title: doc.title,
				source: doc.source,
				status: doc.status,
				chunkCount: doc.chunkCount,
				metadata: doc.metadata,
				createdAt: doc.createdAt.toISOString(),
				updatedAt: doc.updatedAt.toISOString(),
			};
		}
	);

	// List documents
	server.withTypeProvider<ZodTypeProvider>().get(
		"/documents",
		{
			schema: {
				querystring: listQuerySchema,
			},
		},
		async (request) => {
			const parsed = request.query;
			const limit = parsed.limit ?? 20;
			const offset = parsed.offset ?? 0;

			const docs = await listDocuments(limit, offset);

			return {
				documents: docs.map((doc) => ({
					id: doc.id,
					title: doc.title,
					source: doc.source,
					status: doc.status,
					chunkCount: doc.chunkCount,
					createdAt: doc.createdAt.toISOString(),
					updatedAt: doc.updatedAt.toISOString(),
				})),
				total: docs.length,
			};
		}
	);

	// Delete document
	server.withTypeProvider<ZodTypeProvider>().delete(
		"/documents/:id",
		{
			schema: {
				params: documentIdParamsSchema,
			},
		},
		async (request, reply) => {
			const { id } = request.params;

			const doc = await getDocument(id);

			if (!doc) {
				return reply.status(404).send({ error: "Document not found" });
			}

			await deleteDocument(id);

			return { message: "Document deleted successfully" };
		}
	);
};
