import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "./parsers";

const productPage = `<!DOCTYPE html>
<html><head><title>Machine X</title><style>body { color: red; }</style>
<script>window.dataLayer = []; function gtag(){}</script></head>
<body>
<header><a href="index.php"><img src="logo.png" alt="logo"></a></header>
<nav><ul><li><a href="c1.php">Biscuiterie</a></li><li><a href="c2.php">Dateurs</a></li></ul></nav>
<main>
<h1>Machine d'impression</h1>
<p>Presse à chaud <a href="https://example.com/p">hydraulique</a>.</p>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="photo">
<table>
<thead><tr><th>specification</th><th>valeur</th></tr></thead>
<tbody><tr><td>Tension</td><td>220 v - 50 HZ</td></tr>
<tr><td></td><td></td></tr>
<tr><td><p>Poids</p></td><td><p>440 Kg</p></td></tr>
<tr><td>Formats</td><td>A | B</td></tr></tbody>
</table>
</main>
<form><button>Envoyer</button></form>
<footer>Copyright 2023 | Mentions légales</footer>
</body></html>`;

test("parseHTML keeps the content and drops page chrome and code", () => {
	const text = parseHTML(productPage);
	assert.match(text, /# Machine d'impression/);
	assert.match(text, /Presse à chaud hydraulique\./);
	for (const noise of [
		"gtag",
		"color: red",
		"Biscuiterie",
		"Copyright",
		"Envoyer",
		"logo",
		"base64",
		"https://example.com",
		"Machine X",
	]) {
		assert.ok(!text.includes(noise), `"${noise}" should be dropped`);
	}
});

test("parseHTML writes one table row per line and skips empty rows", () => {
	const text = parseHTML(productPage);
	assert.match(text, /^\| specification \| valeur \|\n\| Tension \|/m);
	assert.match(text, /^\| Tension \| 220 v - 50 HZ \|$/m);
	assert.match(text, /^\| Poids \| 440 Kg \|$/m);
	assert.match(text, /^\| Formats \| A \\\| B \|$/m);
	assert.ok(!/^\|\s*\|\s*\|$/m.test(text), "empty row kept");
});

test("parseHTML keeps the header and footer of an article", () => {
	const text = parseHTML(
		"<article><header><h2>Mise en service</h2></header><p>Étape 1</p><footer>Rév. 3</footer></article>",
	);
	assert.match(text, /## Mise en service/);
	assert.match(text, /Étape 1/);
	assert.match(text, /Rév\. 3/);
});

test("parseHTML keeps plain document HTML (DOCX output) intact", () => {
	const text = parseHTML("<h1>Manuel</h1><p>Texte <strong>gras</strong>.</p><ul><li>Un</li><li>Deux</li></ul>");
	assert.equal(text, "# Manuel\n\nTexte **gras**.\n\n*   Un\n*   Deux");
});
