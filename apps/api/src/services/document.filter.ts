import { and, eq, isNull, like, or } from "@repo/db/drizzle-orm";
import { document } from "@repo/db/schema";
import { escapeLike } from "../utils/sql";

/**
 * Documents of a profile (a knowledge base). Documents without a profile
 * follow the default profile, except under `strict` (chat-only keys).
 */
export const profileDocumentsFilter = (
	profile: { id: string; isDefault: boolean },
	userId: string,
	strict = false,
) =>
	and(
		eq(document.userId, userId),
		profile.isDefault && !strict
			? or(eq(document.profileId, profile.id), isNull(document.profileId))
			: eq(document.profileId, profile.id),
	);

/**
 * Documents a search may read: the profile's (or, without a profile, all of
 * the owner's), indexed with one embedding model. Every condition is AND-ed,
 * so `documentId` and `sourcePrefix` can only narrow the scope, never widen it.
 */
export const searchableDocumentsFilter = (options: {
	userId: string;
	embeddingModel: string;
	profile: { id: string; isDefault: boolean } | null;
	strictProfile?: boolean;
	documentId?: string;
	sourcePrefix?: string;
}) =>
	and(
		options.profile
			? profileDocumentsFilter(
					options.profile,
					options.userId,
					options.strictProfile,
				)
			: eq(document.userId, options.userId),
		eq(document.embeddingModel, options.embeddingModel),
		options.documentId
			? eq(document.id, options.documentId)
			: eq(document.status, "indexed"),
		options.sourcePrefix
			? like(document.source, `${escapeLike(options.sourcePrefix)}%`)
			: undefined,
	);
