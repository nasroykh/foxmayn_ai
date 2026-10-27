import { test } from "node:test";
import assert from "node:assert/strict";
import {
	escapeHtml,
	INVITATION_EMAIL_HTML,
	OTP_EMAIL_HTML,
} from "./email_templates";

test("escapeHtml escapes markup and quotes", () => {
	assert.equal(
		escapeHtml(`<a href="x" onclick='y'>&</a>`),
		"&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
	);
});

test("invitation template escapes inviter, organization and link", () => {
	const html = INVITATION_EMAIL_HTML(
		`<script>alert(1)</script>`,
		`Evil" <b>Org</b>`,
		`https://app.example.com/invite/1"><img src=x onerror=alert(1)>`,
	);
	assert.ok(!html.includes("<script>"));
	assert.ok(!html.includes("<b>Org</b>"));
	assert.ok(!html.includes("<img"));
	assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
	assert.ok(html.includes("Evil&quot; &lt;b&gt;Org&lt;/b&gt;"));
	assert.ok(
		html.includes(
			`href="https://app.example.com/invite/1&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"`,
		),
	);
});

test("otp template escapes the code", () => {
	const html = OTP_EMAIL_HTML("12<3");
	assert.ok(html.includes("12&lt;3"));
});

test("templates render normal values unchanged", () => {
	const html = INVITATION_EMAIL_HTML("Jane", "Acme", "https://app.example.com/invite/abc");
	assert.ok(html.includes("<strong>Jane</strong>"));
	assert.ok(html.includes(`href="https://app.example.com/invite/abc"`));
	assert.ok(OTP_EMAIL_HTML("123456").includes("123456"));
});
