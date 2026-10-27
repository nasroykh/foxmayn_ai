/**
 * Job payload types for type-safe queue operations
 */

// ============================================================================
// Document Jobs
// ============================================================================

/**
 * Index (and re-index) payload. The worker reads title, content, source and
 * metadata from the document row, so large text never sits in Redis.
 */
export interface IndexDocumentJobData {
	documentId: string;
	// Owner of the document (tenant key, used to scope job queries)
	userId: string;
	// Organization billed for the embeddings
	organizationId: string;
	profileId?: string;
	// Embedding tokens already paid for by failed attempts (billed on terminal failure)
	embeddedTokens?: number;
	// An earlier attempt already replaced the old index (partial output may exist)
	indexReplaced?: boolean;
	// Once indexed, delete the owner's older documents with the same source and profile
	replaceSource?: boolean;
}

export type ReindexDocumentJobData = IndexDocumentJobData;

export interface DeleteDocumentJobData {
	documentId: string;
	userId: string;
}

// ============================================================================
// Job Results
// ============================================================================

export interface IndexDocumentJobResult {
	documentId: string;
	chunkCount: number;
	processingTimeMs: number;
}

// ============================================================================
// Job Names (for type-safe job.name checks)
// ============================================================================

export const DocumentJobNames = {
	INDEX: "document:index",
	DELETE: "document:delete",
	REINDEX: "document:reindex",
} as const;

export type DocumentJobName =
	(typeof DocumentJobNames)[keyof typeof DocumentJobNames];
