import { z } from "zod";
import { ORPCError } from "@orpc/server";

import {
	getDocument,
	listDocuments,
	countDocuments,
	deleteDocument,
	indexDocument,
	importDocument,
	extractTextFromDocument,
} from "../../services/rag.service";
import { getDocumentJobStatus, getPendingDocumentJobs } from "../../jobs";
import { authProcedure, creditsProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	calculateTokens,
	TIKTOKEN_MODELS,
} from "../../services/chunking.service";

// Metadata is copied into every vector payload
const MAX_METADATA_CHARS = 8_000;

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const documentRoutes = {
	createDocument: creditsProcedure
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
				profileId: z.string().min(1).optional(),
				metadata: z.string().optional(),
			}),
		)
		.output(
			z.object({
				documentId: z.string(),
				jobId: z.string().optional(),
				message: z.string(),
				status: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { file, title, source, metadata, profileId } = input;

			let parsedMetadata: Record<string, unknown> | undefined;
			if (metadata) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(metadata);
				} catch {
					throw new ORPCError("BAD_REQUEST", {
						message: "Invalid metadata JSON",
					});
				}
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					Array.isArray(parsed) ||
					JSON.stringify(parsed).length > MAX_METADATA_CHARS
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: `metadata must be a JSON object of at most ${MAX_METADATA_CHARS} characters`,
					});
				}
				parsedMetadata = parsed as Record<string, unknown>;
			}

			const { documentId, jobId } = await indexDocument({
				file,
				title,
				source,
				profileId,
				metadata: parsedMetadata,
				userId: context.user.id,
				organizationId: context.organizationId,
			});

			return {
				documentId,
				jobId,
				message: "File accepted for processing",
				status: "processing",
			};
		}),

	importDocument: creditsProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/documents/import`,
			description:
				"Create a document from raw text or an https URL. With replace, older documents with the same source are deleted once this one is indexed.",
		})
		.input(
			z
				.object({
					text: z.string().optional(),
					url: z.url().optional(),
					title: z.string().optional(),
					source: z.string().max(2048).optional(),
					profileId: z.string().min(1).optional(),
					metadata: z.record(z.string(), z.unknown()).optional(),
					replace: z.boolean().default(false),
				})
				.refine((v) => (v.text !== undefined) !== (v.url !== undefined), {
					message: "Provide exactly one of text or url",
				})
				.refine((v) => !v.replace || Boolean(v.source ?? v.url), {
					message: "replace requires a source (or a url)",
				}),
		)
		.output(
			z.object({
				documentId: z.string(),
				jobId: z.string().optional(),
				message: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { text, url, title, source, profileId, metadata, replace } = input;

			if (
				metadata &&
				JSON.stringify(metadata).length > MAX_METADATA_CHARS
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: `metadata must be a JSON object of at most ${MAX_METADATA_CHARS} characters`,
				});
			}

			const { documentId, jobId } = await importDocument({
				text,
				url,
				title,
				source,
				profileId,
				metadata,
				replace,
				userId: context.user.id,
				organizationId: context.organizationId,
			});

			return {
				documentId,
				jobId,
				message: "Document accepted for processing",
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
			}),
		)
		.handler(async ({ input, context }) => {
			// Jobs of other users answer NOT_FOUND, same as missing jobs
			const status = await getDocumentJobStatus(input.jobId, context.user.id);

			if (!status) {
				throw new ORPCError("NOT_FOUND", {
					message: "Job not found",
				});
			}

			return {
				jobId: status.jobId,
				state: status.state,
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
			description: "Get the caller's pending/active jobs (paginated)",
		})
		.input(
			z.object({
				offset: z.coerce.number().int().min(0).optional(),
				limit: z.coerce.number().int().min(1).max(100).optional(),
			}),
		)
		.output(
			z.object({
				jobs: z.array(
					z.object({
						jobId: z.string(),
						name: z.string(),
						documentId: z.string(),
						state: z.enum(["active", "waiting", "prioritized", "delayed"]),
						progress: z.number(),
					}),
				),
				hasMore: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { limit = 50, offset = 0 } = input;
			return await getPendingDocumentJobs(context.user.id, { limit, offset });
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
			}),
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
			}),
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
					}),
				),
				total: z.number(),
			}),
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
			}),
		)
		.handler(async ({ input, context }) => {
			const { id } = input;
			const doc = await getDocument(id, context.user.id);

			if (!doc) {
				throw new ORPCError("NOT_FOUND", {
					message: "Document not found",
				});
			}

			const { jobId } = await deleteDocument(id, context.user.id);

			return {
				message: "Document deletion queued",
				jobId,
			};
		}),

	countTokens: authProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/documents/tokens`,
			description: "Count tokens in a document",
		})
		.input(
			z.object({
				file: z.file(),
				model: z.enum(TIKTOKEN_MODELS),
			}),
		)
		.output(z.number())
		.handler(async ({ input }) => {
			// Same type allowlist, size cap, signature check and extraction bounds as upload
			const text = await extractTextFromDocument(input.file);

			return calculateTokens(text, input.model);
		}),
};
