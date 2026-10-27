import { test } from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/server";
import {
	fetchUrlAsFile,
	isPublicAddress,
	validateFetchUrl,
} from "./url_fetch";

test("isPublicAddress accepts public IPv4 and IPv6", () => {
	for (const ip of [
		"8.8.8.8",
		"1.1.1.1",
		"93.184.216.34",
		"172.15.255.255",
		"172.32.0.1",
		"100.63.255.255",
		"100.128.0.1",
		"198.17.255.255",
		"198.20.0.1",
		"2606:4700:4700::1111",
		"2001:4860:4860::8888",
		"::ffff:8.8.8.8",
		"::ffff:808:808",
	]) {
		assert.equal(isPublicAddress(ip), true, ip);
	}
});

test("isPublicAddress rejects every blocked IPv4 range", () => {
	for (const ip of [
		"0.0.0.0",
		"0.255.255.255",
		"10.0.0.1",
		"10.255.255.255",
		"100.64.0.1",
		"100.127.255.255",
		"127.0.0.1",
		"127.255.255.254",
		"169.254.169.254",
		"172.16.0.1",
		"172.31.255.255",
		"192.0.0.1",
		"192.0.2.1",
		"192.168.1.1",
		"198.18.0.1",
		"198.19.255.255",
		"198.51.100.1",
		"203.0.113.1",
		"224.0.0.1",
		"239.255.255.255",
		"240.0.0.1",
		"255.255.255.255",
	]) {
		assert.equal(isPublicAddress(ip), false, ip);
	}
});

test("isPublicAddress rejects every blocked IPv6 range", () => {
	for (const ip of [
		"::",
		"::1",
		"fc00::1",
		"fdff:ffff::1",
		"fe80::1",
		"febf::1",
		"ff02::1",
		"2001:db8::1",
		"2001:db8:ffff::1",
		"100::1",
		"64:ff9b::808:808",
		"64:ff9b::1",
	]) {
		assert.equal(isPublicAddress(ip), false, ip);
	}
});

test("isPublicAddress checks IPv4-mapped IPv6 as IPv4", () => {
	assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
	assert.equal(isPublicAddress("::ffff:7f00:1"), false);
	assert.equal(isPublicAddress("::ffff:10.0.0.5"), false);
	assert.equal(isPublicAddress("::ffff:a00:5"), false);
	assert.equal(isPublicAddress("::ffff:169.254.169.254"), false);
	assert.equal(isPublicAddress("::ffff:192.168.0.1"), false);
});

test("isPublicAddress rejects values that are not IP addresses", () => {
	for (const v of ["", "example.com", "999.1.1.1", "1.2.3", "fe80::1%eth0"]) {
		assert.equal(isPublicAddress(v), false, v);
	}
});

const rejection = (message: string) => (err: unknown) =>
	err instanceof ORPCError &&
	err.code === "BAD_REQUEST" &&
	err.message === message;

test("validateFetchUrl accepts a plain https URL", () => {
	const url = validateFetchUrl("https://example.com/llms-full.txt");
	assert.equal(url.hostname, "example.com");
	assert.equal(validateFetchUrl("https://example.com:443/a").port, "");
	assert.equal(validateFetchUrl("https://8.8.8.8/a").hostname, "8.8.8.8");
});

test("validateFetchUrl rejects http and other schemes", () => {
	for (const u of ["http://example.com/a", "ftp://example.com/a", "file:///etc/passwd"]) {
		assert.throws(() => validateFetchUrl(u), rejection("URL must use https"), u);
	}
});

test("validateFetchUrl rejects malformed URLs", () => {
	assert.throws(() => validateFetchUrl("not a url"), rejection("Invalid URL"));
});

test("validateFetchUrl rejects credentials", () => {
	for (const u of ["https://user:pw@example.com/", "https://user@example.com/"]) {
		assert.throws(
			() => validateFetchUrl(u),
			rejection("URL must not contain credentials"),
			u,
		);
	}
});

test("validateFetchUrl rejects any port but 443", () => {
	for (const u of ["https://example.com:8443/", "https://example.com:80/"]) {
		assert.throws(
			() => validateFetchUrl(u),
			rejection("URL must use the default https port"),
			u,
		);
	}
});

test("validateFetchUrl rejects private IP literals, including obfuscated ones", () => {
	for (const u of [
		"https://127.0.0.1/",
		"https://10.0.0.5/x",
		"https://169.254.169.254/latest/meta-data",
		"https://192.168.1.1/",
		"https://[::1]/",
		"https://[fd00::1]/",
		"https://[::ffff:127.0.0.1]/",
		"https://[::ffff:7f00:1]/",
		"https://2130706433/",
		"https://0x7f.1/",
		"https://127.1/",
	]) {
		assert.throws(
			() => validateFetchUrl(u),
			rejection("URL resolves to a private address"),
			u,
		);
	}
});

test("fetchUrlAsFile rejects before any network access", async () => {
	await assert.rejects(
		fetchUrlAsFile("http://example.com/a"),
		rejection("URL must use https"),
	);
	await assert.rejects(
		fetchUrlAsFile("https://127.0.0.1/a"),
		rejection("URL resolves to a private address"),
	);
});
