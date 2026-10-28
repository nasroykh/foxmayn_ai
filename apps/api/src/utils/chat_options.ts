import { z } from "zod";

export const MAX_EXCLUDED_SOURCE_PREFIXES = 8;

// Retrieval options shared by the query and search endpoints
export const queryOptionsSchema = z
	.object({
		limit: z.number().min(1).max(20).optional(),
		scoreThreshold: z.number().min(0).max(1).optional(),
		documentId: z.string().optional(),
		source: z.string().optional(),
		// Only documents whose source starts with this, e.g. "https://example.com/en/"
		sourcePrefix: z.string().min(1).max(512).optional(),
		// Never documents whose source starts with one of these, e.g. "https://example.com/en/dz/"
		excludeSourcePrefixes: z
			.array(z.string().min(1).max(512))
			.max(MAX_EXCLUDED_SOURCE_PREFIXES)
			.optional(),
		profileId: z.string().optional(),
	})
	.optional();
