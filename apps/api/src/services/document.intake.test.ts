import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PDF_MIME,
	needsVisionParsing,
	queueDocumentProcessing,
	type IntakeDeps,
} from "./document.intake";
import { DocumentJobNames } from "../jobs/document/types";

/** Records what the intake does, in order. */
const fakeDeps = (options: { failQueue?: boolean } = {}) => {
	const calls: { step: string; data: unknown }[] = [];
	const deps: IntakeDeps = {
		storeFile: async (documentId, file) => {
			calls.push({ step: "store", data: { documentId, ...file } });
		},
		queueIndex: async (data) => {
			calls.push({ step: DocumentJobNames.INDEX, data });
			if (options.failQueue) throw new Error("queue down");
			return { jobId: `index-${data.documentId}` };
		},
		queueTranscribe: async (data) => {
			calls.push({ step: DocumentJobNames.TRANSCRIBE, data });
			if (options.failQueue) throw new Error("queue down");
			return { jobId: `transcribe-${data.documentId}` };
		},
	};
	return { deps, calls };
};

const jobData = {
	documentId: "doc-1",
	userId: "user-1",
	organizationId: "org-1",
	profileId: "profile-1",
	replaceSource: true,
};
const pdf = Buffer.from("%PDF-1.7 fake");

test("a PDF in a vision profile is stored, then transcribed first", async () => {
	const { deps, calls } = fakeDeps();
	const out = await queueDocumentProcessing(deps, {
		...jobData,
		pdf,
		profile: { pdfParsing: "vision" },
	});

	assert.deepEqual(out, { jobId: "transcribe-doc-1", transcribe: true });
	// The file must exist before the job that reads it can start
	assert.deepEqual(
		calls.map((c) => c.step),
		["store", DocumentJobNames.TRANSCRIBE],
	);
	assert.deepEqual(calls[0].data, {
		documentId: "doc-1",
		mimeType: PDF_MIME,
		data: pdf,
	});
	// Same data as the index job would get, replaceSource and profileId included
	assert.deepEqual(calls[1].data, jobData);
});

test("a PDF in a text profile is indexed without storing the file", async () => {
	const { deps, calls } = fakeDeps();
	const out = await queueDocumentProcessing(deps, {
		...jobData,
		pdf,
		profile: { pdfParsing: "text" },
	});

	assert.deepEqual(out, { jobId: "index-doc-1", transcribe: false });
	assert.deepEqual(
		calls.map((c) => c.step),
		[DocumentJobNames.INDEX],
	);
	assert.deepEqual(calls[0].data, jobData);
});

test("anything that is not a PDF is indexed, whatever the profile says", async () => {
	const { deps, calls } = fakeDeps();
	const out = await queueDocumentProcessing(deps, {
		...jobData,
		profile: { pdfParsing: "vision" },
	});

	assert.equal(out.transcribe, false);
	assert.deepEqual(
		calls.map((c) => c.step),
		[DocumentJobNames.INDEX],
	);
});

test("no profile means the text layer", async () => {
	const { deps, calls } = fakeDeps();
	for (const profile of [null, undefined]) {
		const out = await queueDocumentProcessing(deps, { ...jobData, pdf, profile });
		assert.equal(out.transcribe, false);
	}
	assert.equal(
		calls.every((c) => c.step === DocumentJobNames.INDEX),
		true,
	);
	assert.equal(needsVisionParsing(null, pdf), false);
	assert.equal(needsVisionParsing({ pdfParsing: "vision" }, undefined), false);
	assert.equal(needsVisionParsing({ pdfParsing: "vision" }, pdf), true);
	// An unknown stored value never turns vision (and its bill) on
	assert.equal(needsVisionParsing({ pdfParsing: "ocr" }, pdf), false);
});

test("a queue failure surfaces so the caller can drop the document row", async () => {
	const { deps } = fakeDeps({ failQueue: true });
	await assert.rejects(
		queueDocumentProcessing(deps, {
			...jobData,
			pdf,
			profile: { pdfParsing: "vision" },
		}),
		{ message: "queue down" },
	);
});
