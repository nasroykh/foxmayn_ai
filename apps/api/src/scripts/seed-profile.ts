import { db, ragProfile } from "@repo/db";
import { randomUUID } from "node:crypto";

async function seed() {
	console.log("🌱 Seeding default RAG profile...");

	const id = randomUUID();
	await db.insert(ragProfile).values({
		id,
		name: "Default Profile",
		description: "Standard settings for Foxmayn AI",
		isDefault: true,
		embeddingModel: "openai/text-embedding-3-small",
		chunkSize: 500,
		chunkOverlap: 50,
		separators: ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""],
		addContextualPrefix: true,
		retrievalStrategy: "similarity",
		scoreThreshold: 0.3,
		topK: 5,
		model: "google/gemini-2.5-flash-lite",
		temperature: 0.7,
		topP: 1.0,
		maxTokens: 2048,
		reasoningEffort: "none",
		assistantName: "Hafid",
		companyName: "Foxmayn",
		domain: "Accounting Expert",
		tone: "friendly",
		responseLength: "balanced",
		language: "English",
		enableCitations: true,
		customInstructions: [],
	});

	console.log("✅ Default profile created");
	process.exit(0);
}

seed().catch((err) => {
	console.error("❌ Seeding failed:", err);
	process.exit(1);
});
