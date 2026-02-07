import { z } from "zod";
import { ORPCError } from "@orpc/server";

import {
	getDocument,
	listDocuments,
	countDocuments,
	deleteDocument,
	indexDocument,
	extractTextFromDocument,
} from "../../services/rag.service";
import { getDocumentJobStatus, getPendingDocumentJobs } from "../../jobs";
import { authProcedure, publicProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	calculateTokens,
	TIKTOKEN_MODELS,
} from "../../services/chunking.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const documentRoutes = {
	createDocument: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/documents`,
			description: "Upload a file and index as document",
		})
		.input(
			z.object({
				file: z.file(),
				title: z.string().optional(),
				source: z.string().optional(),
				profileId: z.string().optional(),
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
		.handler(async ({ input, context }) => {
			const { file, title, source, metadata, profileId } = input;

			let parsedMetadata: Record<string, unknown> | undefined;
			if (metadata) {
				try {
					parsedMetadata = JSON.parse(metadata);
				} catch {
					throw new ORPCError("BAD_REQUEST", {
						message: "Invalid metadata JSON",
					});
				}
			}

			const { documentId, jobId } = await indexDocument({
				file,
				title,
				source,
				profileId,
				metadata: parsedMetadata,
				userId: context.user.id,
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
		.handler(async ({ input, context }) => {
			const { id } = input;
			const doc = await getDocument(id, context.user.id);

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
		.handler(async ({ input, context }) => {
			const { limit = 20, offset = 0 } = input;
			const userId = context.user.id;
			const [docs, total] = await Promise.all([
				listDocuments(limit, offset, userId),
				countDocuments(userId),
			]);

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
				total,
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
		.handler(async ({ input, context }) => {
			const { id } = input;
			const doc = await getDocument(id, context.user.id);

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

	countTokens: publicProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/documents/tokens`,
			description: "Count tokens in a document",
		})
		.input(
			z.object({
				file: z.file(),
				model: z.enum(TIKTOKEN_MODELS),
			})
		)
		.output(z.number())
		.handler(async ({ input }) => {
			const { file } = input;

			const text = await extractTextFromDocument(file);

			const tokens = calculateTokens(text, input.model);

			return tokens;
		}),
};
