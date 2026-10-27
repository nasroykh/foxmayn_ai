import { db, document } from "@repo/db";
import { asc } from "@repo/db/drizzle-orm";
import { listCollectionNames, ensureKeywordIndex } from "@repo/qdrant";
import { COLLECTION_NAME, qdrant } from "../services/qdrant.shared";
import { isVectorCollection } from "../services/qdrant.filter";

const PAGE_SIZE = 500;

/**
 * Sets the `userId` payload on every existing Qdrant point, using the owner
 * from PostgreSQL (document.userId) matched by documentId.
 *
 * Idempotent: re-running just rewrites the same value. Points whose document
 * no longer exists are left without `userId`, so owner-scoped searches never
 * return them.
 */
async function backfill() {
	console.log("Backfilling Qdrant userId payload...");

	const collections = (await listCollectionNames(qdrant)).filter((name) =>
		isVectorCollection(name, COLLECTION_NAME),
	);
	if (collections.length === 0) {
		console.log("No vector collections found, nothing to do.");
		return;
	}

	for (const name of collections) {
		await ensureKeywordIndex(qdrant, name, "userId");
	}

	let updated = 0;
	for (let offset = 0; ; offset += PAGE_SIZE) {
		const docs = await db
			.select({ id: document.id, userId: document.userId })
			.from(document)
			.orderBy(asc(document.id))
			.limit(PAGE_SIZE)
			.offset(offset);
		if (docs.length === 0) break;

		for (const doc of docs) {
			for (const name of collections) {
				await qdrant.setPayload(name, {
					payload: { userId: doc.userId },
					filter: { must: [{ key: "documentId", match: { value: doc.id } }] },
					wait: true,
				});
			}
			updated++;
		}
		console.log(`  ${updated} documents processed`);
	}

	console.log(
		`Done: ${updated} documents across ${collections.length} collection(s).`,
	);
}

backfill()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Backfill failed:", err);
		process.exit(1);
	});
