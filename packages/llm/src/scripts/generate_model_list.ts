/**
 * Refreshes prices and context lengths in src/data/openrouter_models.ts.
 *
 * Single source of truth: the model ids (and embedding dimensions) are read
 * from the committed data file itself. To add a model, append an entry with
 * placeholder prices (0) to that file and run `pnpm --filter @repo/llm models:generate`.
 * To remove one, delete its entry.
 *
 * Exits non-zero (and writes nothing) if OpenRouter cannot be reached or any
 * listed model is missing from its catalogue, so a bad run cannot zero-price
 * a model.
 */
import fs from "fs";
import path from "path";
import {
	OPENROUTER_AI_MODELS,
	OPENROUTER_EMBEDDING_MODELS,
} from "../data/openrouter_models";

interface OpenRouterModel {
	id: string;
	pricing: { prompt: string; completion: string };
	context_length: number;
}

interface OpenRouterResponse {
	data: OpenRouterModel[];
}

async function fetchModels(url: string): Promise<OpenRouterModel[]> {
	const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
	}
	const parsed = (await response.json()) as OpenRouterResponse;
	if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
		throw new Error(`GET ${url} returned no models`);
	}
	return parsed.data;
}

// OpenRouter prices are USD per token; the data file stores USD per 1M tokens.
const perMillion = (price: string): number => {
	const value = parseFloat(price) * 1_000_000;
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid price "${price}"`);
	}
	return Number(value.toFixed(6));
};

async function main() {
	const [chatModels, embeddingModels] = await Promise.all([
		fetchModels("https://openrouter.ai/api/v1/models"),
		fetchModels("https://openrouter.ai/api/v1/embeddings/models"),
	]);

	const missing: string[] = [];

	const chatLines = OPENROUTER_AI_MODELS.map(({ id }) => {
		const found = chatModels.find((m) => m.id === id);
		if (!found) {
			missing.push(id);
			return "";
		}
		return `\t{ id: "${id}", inputPrice: ${perMillion(found.pricing.prompt)}, outputPrice: ${perMillion(found.pricing.completion)}, contextLength: ${found.context_length} },`;
	});

	const embeddingLines = OPENROUTER_EMBEDDING_MODELS.map(
		({ id, dimensions }) => {
			const found = embeddingModels.find((m) => m.id === id);
			if (!found) {
				missing.push(id);
				return "";
			}
			return `\t{ id: "${id}", dimensions: ${dimensions}, inputPrice: ${perMillion(found.pricing.prompt)}, outputPrice: ${perMillion(found.pricing.completion)}, contextLength: ${found.context_length} },`;
		},
	);

	if (missing.length > 0) {
		throw new Error(
			`Not found on OpenRouter (remove or rename in src/data/openrouter_models.ts): ${missing.join(", ")}`,
		);
	}

	const output =
		"// prettier-ignore\n\n" +
		"export const OPENROUTER_AI_MODELS = [\n" +
		chatLines.join("\n") +
		"\n] as const;\n\n" +
		"// prettier-ignore\n\n" +
		"export const OPENROUTER_EMBEDDING_MODELS = [\n" +
		embeddingLines.join("\n") +
		"\n] as const;\n";

	// Resolves to src/ whether run through tsx (src/scripts) or from dist/scripts.
	const filePath = path.resolve(
		__dirname,
		"../../src/data/openrouter_models.ts",
	);
	fs.writeFileSync(filePath, output, "utf-8");
	console.log(
		`Updated ${chatLines.length} chat and ${embeddingLines.length} embedding models in ${filePath}`,
	);
}

main().catch((error) => {
	console.error("Error generating models:", error);
	process.exit(1);
});
