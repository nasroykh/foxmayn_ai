/**
 * Which job a new document goes to. A PDF added to a "vision" profile is
 * stored and transcribed page by page first; everything else is indexed
 * straight away. Kept apart from rag.service (which needs Redis and the
 * database) so the decision and the order of its steps can be unit tested.
 */

import type {
	IndexDocumentJobData,
	TranscribeDocumentJobData,
} from "../jobs/document/types";

export const PDF_MIME = "application/pdf";

export interface IntakeDeps {
	/** Keep the original file next to the document row (the transcribe job reads it). */
	storeFile: (
		documentId: string,
		file: { mimeType: string; data: Buffer },
	) => Promise<void>;
	queueIndex: (
		data: IndexDocumentJobData,
	) => Promise<{ jobId: string | undefined }>;
	queueTranscribe: (
		data: TranscribeDocumentJobData,
	) => Promise<{ jobId: string | undefined }>;
}

/** True when this upload must be read by the vision model. */
export const needsVisionParsing = (
	profile: { pdfParsing: string } | null | undefined,
	pdf: Buffer | undefined,
): pdf is Buffer => pdf !== undefined && profile?.pdfParsing === "vision";

/**
 * Queue the processing of a document row that already exists.
 * `pdf` is the original file, given only for PDFs.
 */
export const queueDocumentProcessing = async (
	deps: IntakeDeps,
	options: IndexDocumentJobData & {
		pdf?: Buffer;
		profile: { pdfParsing: string } | null | undefined;
	},
): Promise<{ jobId: string | undefined; transcribe: boolean }> => {
	const { pdf, profile, ...jobData } = options;

	if (needsVisionParsing(profile, pdf)) {
		await deps.storeFile(jobData.documentId, {
			mimeType: PDF_MIME,
			data: pdf,
		});
		const { jobId } = await deps.queueTranscribe(jobData);
		return { jobId, transcribe: true };
	}

	const { jobId } = await deps.queueIndex(jobData);
	return { jobId, transcribe: false };
};
