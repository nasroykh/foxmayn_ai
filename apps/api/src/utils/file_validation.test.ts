import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DOCX_MIME,
	isAllowedFileType,
	matchesFileSignature,
	zipDeclaredUncompressedSize,
	zipInflatesWithin,
} from "./file_validation";

const bytes = (s: string) => new TextEncoder().encode(s);

test("allowlist excludes legacy and spreadsheet types", () => {
	assert.equal(isAllowedFileType("application/pdf"), true);
	assert.equal(isAllowedFileType("application/msword"), false);
	assert.equal(isAllowedFileType("application/vnd.ms-excel"), false);
});

test("pdf needs the %PDF- signature", () => {
	assert.equal(matchesFileSignature("application/pdf", bytes("%PDF-1.7\n...")), true);
	assert.equal(matchesFileSignature("application/pdf", bytes("junk%PDF-1.4")), true);
	assert.equal(matchesFileSignature("application/pdf", bytes("PK\u0003\u0004")), false);
	assert.equal(matchesFileSignature("application/pdf", bytes("hello")), false);
});

test("docx needs a zip signature", () => {
	assert.equal(matchesFileSignature(DOCX_MIME, Uint8Array.from([0x50, 0x4b, 3, 4, 0])), true);
	assert.equal(matchesFileSignature(DOCX_MIME, bytes("%PDF-1.7")), false);
});

test("text types reject binary data", () => {
	assert.equal(matchesFileSignature("text/plain", bytes("hello world")), true);
	assert.equal(matchesFileSignature("text/plain", Uint8Array.from([104, 0, 105])), false);
	assert.equal(matchesFileSignature("text/html", Uint8Array.from([0x50, 0x4b, 0, 0])), false);
});

test("unknown types never match", () => {
	assert.equal(matchesFileSignature("application/zip", bytes("PK")), false);
});

// Minimal zip: one central directory entry + end of central directory record
const zipWithDeclaredSize = (size: number) => {
	const cd = new Uint8Array(46);
	const cdv = new DataView(cd.buffer);
	cdv.setUint32(0, 0x02014b50, true);
	cdv.setUint32(24, size, true);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(10, 1, true);
	ev.setUint32(12, 46, true);
	ev.setUint32(16, 0, true); // central directory at offset 0
	const out = new Uint8Array(cd.length + eocd.length);
	out.set(cd, 0);
	out.set(eocd, cd.length);
	return out;
};

test("zipDeclaredUncompressedSize reads the declared total", () => {
	assert.equal(zipDeclaredUncompressedSize(zipWithDeclaredSize(1234)), 1234);
});

test("zipDeclaredUncompressedSize flags malformed archives", () => {
	assert.equal(zipDeclaredUncompressedSize(bytes("not a zip at all, just text....")), null);
	assert.equal(zipDeclaredUncompressedSize(zipWithDeclaredSize(0xffffffff)), null);
});

/** One-entry zip with deflate data; `declared` is what the headers claim. */
const zipOfEntry = (content: Uint8Array, declared: number): Uint8Array => {
	const data = deflateRawSync(content);
	const name = Buffer.from("word/document.xml");
	const local = Buffer.alloc(30 + name.length);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(8, 8);
	local.writeUInt32LE(data.length, 18);
	local.writeUInt32LE(declared, 22);
	local.writeUInt16LE(name.length, 26);
	name.copy(local, 30);
	const central = Buffer.alloc(46 + name.length);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(8, 10);
	central.writeUInt32LE(data.length, 20);
	central.writeUInt32LE(declared, 24);
	central.writeUInt16LE(name.length, 28);
	central.writeUInt32LE(0, 42);
	name.copy(central, 46);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(central.length, 12);
	eocd.writeUInt32LE(local.length + data.length, 16);
	return Buffer.concat([local, data, central, eocd]);
};

test("zipInflatesWithin accepts an archive inside the limit", () => {
	const content = Buffer.alloc(10_000, "a");
	assert.equal(zipInflatesWithin(zipOfEntry(content, content.length), 20_000), true);
});

test("zipInflatesWithin rejects a zip bomb that declares a small size", () => {
	const content = Buffer.alloc(5_000_000, 0);
	const bomb = zipOfEntry(content, 100);
	// The lie passes the declared-size check ...
	assert.equal(zipDeclaredUncompressedSize(bomb), 100);
	// ... but not the real inflate with a cap
	assert.equal(zipInflatesWithin(bomb, 1_000_000), false);
});

test("zipInflatesWithin rejects non-zip data", () => {
	assert.equal(zipInflatesWithin(bytes("not a zip at all, just text...."), 1_000), false);
});
