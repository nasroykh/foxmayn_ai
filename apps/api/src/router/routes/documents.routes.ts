import { z } from "zod";
import { ORPCError } from "@orpc/server";

import {
	indexDocument,
	getDocument,
	listDocuments,
	deleteDocument,
} from "../../services/rag.service";
import { getDocumentJobStatus, getPendingDocumentJobs } from "../../jobs";
import { authProcedure } from "../middleware";
import { env } from "../../config/env";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

const ALLOWED_TEXT_EXTENSIONS = [
	".txt",
	".md",
	".csv",
	".json",
	".xml",
	".html",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const documentRoutes = {
	createDocument: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/documents`,
			description: "Create a new document",
		})
		.input(
			z.object({
				title: z.string().min(1).max(500),
				content: z.string().min(1),
				source: z.string().max(1000).optional(),
				metadata: z.record(z.string(), z.unknown()).optional(),
			})
		)
		.output(
			z.object({
				documentId: z.string(),
				jobId: z.string().optional(),
				message: z.string(),
				status: z.string(),
			})
		)
		.handler(async ({ input }) => {
			const { title, content, source, metadata } = input;

			const { documentId, jobId } = await indexDocument({
				title,
				content,
				source,
				metadata,
			});

			return {
				documentId,
				jobId,
				message: "Document accepted for processing",
				status: "processing",
			};
		}),

	uploadDocument: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/documents/upload`,
			description: "Upload a text file and index as document",
		})
		.input(
			z.object({
				file: z.file(),
				title: z.string().optional(),
				source: z.string().optional(),
				metadata: z.string().optional(),
			})
		)
		.output(
			z.object({
				documentId: z.string(),
				jobId: z.string().optional(),
				message: z.string(),
				status: z.string(),
			})
		)
		.handler(async ({ input }) => {
			const { file, title, source, metadata: metadataRaw } = input;

			// Validate file extension
			const filename = (file as any).name?.toLowerCase();
			if (filename) {
				const hasValidExtension = ALLOWED_TEXT_EXTENSIONS.some((ext) =>
					filename.endsWith(ext)
				);

				if (!hasValidExtension) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Invalid file type. Allowed: ${ALLOWED_TEXT_EXTENSIONS.join(
							", "
						)}`,
					});
				}
			}

			if (file.size > MAX_FILE_SIZE) {
				throw new ORPCError("BAD_REQUEST", {
					message: "File too large (max 10MB)",
				});
			}

			const content = await file.text();

			if (!content.trim()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "File is empty",
				});
			}

			let metadata: Record<string, unknown> | undefined;
			if (metadataRaw) {
				try {
					metadata = JSON.parse(metadataRaw);
				} catch {
					throw new ORPCError("BAD_REQUEST", {
						message: "Invalid metadata JSON",
					});
				}
			}

			const { documentId, jobId } = await indexDocument({
				title: title || filename || "Untitled",
				content,
				source,
				metadata,
			});

			return {
				documentId,
				jobId,
				message: "File accepted for processing",
				status: "processing",
			};
		}),

	getJobStatus: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/documents/jobs/{jobId}`,
			description: "Get job status",
		})
		.input(z.object({ jobId: z.string() }))
		.output(
			z.object({
				jobId: z.string(),
				state: z.string(),
				progress: z.string().optional(),
				result: z.any().optional(),
				error: z.string().optional(),
				attemptsMade: z.number(),
				processedOn: z.number().optional(),
				finishedOn: z.number().optional(),
			})
		)
		.handler(async ({ input }) => {
			const { jobId } = input;
			const status = await getDocumentJobStatus(jobId);

			if (!status) {
				throw new ORPCError("NOT_FOUND", {
					message: "Job not found",
				});
			}

			return {
				jobId: status.jobId || "",
				state: status.state || "",
				progress: status.progress.toString(),
				result: status.returnvalue,
				error: status.failedReason,
				attemptsMade: status.attemptsMade,
				processedOn: status.processedOn,
				finishedOn: status.finishedOn,
			};
		}),

	getPendingJobs: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/documents/jobs`,
			description: "Get all pending/active jobs",
		})
		.handler(async () => {
			return await getPendingDocumentJobs();
		}),

	getDocument: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/documents/{id}`,
			description: "Get a document by ID",
		})
		.input(z.object({ id: z.coerce.string() }))
		.output(
			z.object({
				id: z.string(),
				title: z.string(),
				source: z.string().optional().nullable(),
				status: z.string(),
				chunkCount: z.number(),
				metadata: z.record(z.string(), z.unknown()).optional().nullable(),
				createdAt: z.string(),
				updatedAt: z.string(),
			})
		)
		.handler(async ({ input }) => {
			const { id } = input;
			const doc = await getDocument(id);

			if (!doc) {
				throw new ORPCError("NOT_FOUND", {
					message: "Document not found",
				});
			}

			return {
				id: doc.id,
				title: doc.title,
				source: doc.source,
				status: doc.status,
				chunkCount: doc.chunkCount || 0,
				metadata: doc.metadata as Record<string, unknown>,
				createdAt: doc.createdAt.toISOString(),
				updatedAt: doc.updatedAt.toISOString(),
			};
		}),

	listDocuments: authProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/documents`,
			description: "List documents",
		})
		.input(
			z.object({
				offset: z.coerce.number().min(0).optional(),
				limit: z.coerce.number().min(1).max(100).optional(),
			})
		)
		.output(
			z.object({
				documents: z.array(
					z.object({
						id: z.string(),
						title: z.string(),
						source: z.string().optional().nullable(),
						status: z.string(),
						chunkCount: z.number(),
						createdAt: z.string(),
						updatedAt: z.string(),
					})
				),
				total: z.number(),
			})
		)
		.handler(async ({ input }) => {
			const { limit = 20, offset = 0 } = input;
			const docs = await listDocuments(limit, offset);

			return {
				documents: docs.map((doc) => ({
					id: doc.id,
					title: doc.title,
					source: doc.source,
					status: doc.status,
					chunkCount: doc.chunkCount || 0,
					createdAt: doc.createdAt.toISOString(),
					updatedAt: doc.updatedAt.toISOString(),
				})),
				total: docs.length,
			};
		}),

	deleteDocument: authProcedure
		.route({
			method: "DELETE",
			path: `${PREFIX}/documents/{id}`,
			description: "Delete a document",
		})
		.input(z.object({ id: z.coerce.string() }))
		.output(
			z.object({
				message: z.string(),
				jobId: z.string().optional(),
			})
		)
		.handler(async ({ input }) => {
			const { id } = input;
			const doc = await getDocument(id);

			if (!doc) {
				throw new ORPCError("NOT_FOUND", {
					message: "Document not found",
				});
			}

			const { jobId } = await deleteDocument(id);

			return {
				message: "Document deletion queued",
				jobId,
			};
		}),
};
