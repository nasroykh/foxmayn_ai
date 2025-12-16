import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
	indexDocument,
	getDocument,
	listDocuments,
	deleteDocument,
} from "../../services/rag.service";
import { getDocumentJobStatus, getPendingDocumentJobs } from "../../jobs";
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

const jobIdParamsSchema = z.object({
	jobId: z.string(),
});

const listQuerySchema = z.object({
	limit: z.coerce.number().min(1).max(100).optional(),
	offset: z.coerce.number().min(0).optional(),
});

export const registerDocumentRoutes = async (server: FastifyInstance) => {
	// Create and index a document (ASYNC - returns immediately with jobId)
	server.withTypeProvider<ZodTypeProvider>().post(
		"/documents",
		{
			schema: {
				body: createDocumentSchema,
				response: {
					202: z.object({
						documentId: z.string(),
						jobId: z.string().optional(),
						message: z.string(),
						status: z.string(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { title, content, source, metadata } = request.body;

			const { documentId, jobId } = await indexDocument({
				title,
				content,
				source,
				metadata,
			});

			// Return 202 Accepted - processing is async
			return reply.status(202).send({
				documentId,
				jobId,
				message: "Document accepted for processing",
				status: "processing",
			});
		}
	);

	// Upload a text file and index as document (ASYNC)
	server.post(
		"/documents/upload",
		{
			schema: {
				consumes: ["multipart/form-data"],
				response: {
					202: z.object({
						documentId: z.string(),
						jobId: z.string().optional(),
						message: z.string(),
						status: z.string(),
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

			const { documentId, jobId } = await indexDocument({
				title,
				content,
				source,
				metadata,
			});

			// Return 202 Accepted
			return reply.status(202).send({
				documentId,
				jobId,
				message: "File accepted for processing",
				status: "processing",
			});
		}
	);

	// Get job status (for polling)
	server.withTypeProvider<ZodTypeProvider>().get(
		"/documents/jobs/:jobId",
		{
			schema: {
				params: jobIdParamsSchema,
			},
		},
		async (request, reply) => {
			const { jobId } = request.params;

			const status = await getDocumentJobStatus(jobId);

			if (!status) {
				return reply.status(404).send({ error: "Job not found" });
			}

			return {
				jobId: status.jobId,
				state: status.state,
				progress: status.progress,
				result: status.returnvalue,
				error: status.failedReason,
				attemptsMade: status.attemptsMade,
				processedOn: status.processedOn,
				finishedOn: status.finishedOn,
			};
		}
	);

	// Get all pending/active jobs
	server.get("/documents/jobs", async () => {
		return getPendingDocumentJobs();
	});

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
			const { limit = 20, offset = 0 } = request.query;

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

	// Delete document (ASYNC)
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

			const { jobId } = await deleteDocument(id);

			return reply.status(202).send({
				message: "Document deletion queued",
				jobId,
			});
		}
	);
};
