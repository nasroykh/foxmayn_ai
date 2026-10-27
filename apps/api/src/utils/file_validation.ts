/**
 * Upload limits and content sniffing. Pure (no I/O) so it can be unit tested.
 */

export const ALLOWED_FILE_TYPES = [
	"text/plain",
	"text/markdown",
	"text/html",
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

export const DOCX_MIME =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_PDF_PAGES = 500;
// Hard cap on extracted text, so a small file cannot expand into a huge index job
export const MAX_EXTRACTED_CHARS = 5_000_000;
// A docx is a zip: cap the declared uncompressed size to refuse zip bombs
export const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;

export const isAllowedFileType = (type: string): type is AllowedFileType =>
	(ALLOWED_FILE_TYPES as readonly string[]).includes(type);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

const startsWith = (bytes: Uint8Array, magic: number[], offset = 0) =>
	magic.every((b, i) => bytes[offset + i] === b);

/**
 * True when the bytes plausibly match the declared MIME type.
 * pdf and docx need their file signature, text types must not contain NUL bytes.
 */
export const matchesFileSignature = (
	type: string,
	bytes: Uint8Array,
): boolean => {
	switch (type) {
		case "application/pdf": {
			// The spec allows junk before the header, within the first 1024 bytes
			const limit = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
			for (let i = 0; i <= limit; i++) {
				if (startsWith(bytes, PDF_MAGIC, i)) return true;
			}
			return false;
		}
		case DOCX_MIME:
			return startsWith(bytes, ZIP_MAGIC);
		case "text/plain":
		case "text/markdown":
		case "text/html": {
			const head = bytes.subarray(0, 8192);
			return !head.includes(0);
		}
		default:
			return false;
	}
};

/**
 * Sum of the uncompressed sizes declared in a zip's central directory.
 * Returns null when the archive is malformed or declares too many entries.
 */
export const zipDeclaredUncompressedSize = (bytes: Uint8Array): number | null => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// End of central directory record: last 22..65557 bytes
	let eocd = -1;
	const minPos = Math.max(0, bytes.length - 22 - 0xffff);
	for (let i = bytes.length - 22; i >= minPos; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return null;

	const entries = view.getUint16(eocd + 10, true);
	const cdOffset = view.getUint32(eocd + 16, true);
	if (entries > MAX_ZIP_ENTRIES) return null;
	// 0xFFFF / 0xFFFFFFFF mean zip64: not a normal docx
	if (entries === 0xffff || cdOffset === 0xffffffff) return null;

	let total = 0;
	let pos = cdOffset;
	for (let i = 0; i < entries; i++) {
		if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) {
			return null;
		}
		const size = view.getUint32(pos + 24, true);
		if (size === 0xffffffff) return null;
		total += size;
		const nameLen = view.getUint16(pos + 28, true);
		const extraLen = view.getUint16(pos + 30, true);
		const commentLen = view.getUint16(pos + 32, true);
		pos += 46 + nameLen + extraLen + commentLen;
	}
	return total;
};
