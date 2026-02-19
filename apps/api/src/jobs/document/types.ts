/**
 * Job payload types for type-safe queue operations
 */

// ============================================================================
// Document Jobs
// ============================================================================

export interface IndexDocumentJobData {
	documentId: string;
	title: string;
	content: string;
	source?: string;
	metadata?: Record<string, unknown>;
	chunkOptions?: {
		chunkSize?: number;
		chunkOverlap?: number;
	};
	profileId?: string;
}

export interface DeleteDocumentJobData {
	documentId: string;
}

export interface ReindexDocumentJobData {
	documentId: string;
	// Optionally re-chunk with new options
	chunkOptions?: {
		chunkSize?: number;
		chunkOverlap?: number;
	};
	profileId?: string;
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
