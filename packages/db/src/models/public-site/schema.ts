import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";
import { ragProfile } from "../rag/schema";

/** UI text of a public site. Validated by the API on every write. */
export type PublicSiteSettings = {
	title?: string;
	subtitle?: string;
	placeholder?: string;
	disclaimer?: string;
	suggestions?: string[];
	supportText?: string;
	// Shown on a 429; `{minutes}` is replaced by the wait
	rateLimitText?: string;
};

// Public site: a hostname that serves a no-sign-in chat with one knowledge base.
// The chat runs as `userId` (owner of the profile) and is billed to `organizationId`.
export const publicSite = pgTable("public_site", {
	// Lowercase, no port
	hostname: text("hostname").primaryKey(),
	profileId: text("profile_id")
		.references(() => ragProfile.id, { onDelete: "cascade" })
		.notNull(),
	userId: text("user_id")
		.references(() => user.id, { onDelete: "cascade" })
		.notNull(),
	organizationId: text("organization_id")
		.references(() => organization.id, { onDelete: "cascade" })
		.notNull(),
	enabled: boolean("enabled").default(true).notNull(),
	settings: jsonb("settings")
		.$type<PublicSiteSettings>()
		.default({})
		.notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});
