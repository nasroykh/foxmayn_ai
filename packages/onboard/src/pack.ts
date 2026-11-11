import { z } from "zod";

// Mirrors the API's public site settings (apps/api/src/utils/public_site.ts)
const siteSchema = z.strictObject({
	title: z.string().trim().max(100).optional(),
	subtitle: z.string().trim().max(200).optional(),
	placeholder: z.string().trim().max(100).optional(),
	disclaimer: z.string().trim().max(300).optional(),
	suggestions: z.array(z.string().trim().min(1).max(150)).max(6).optional(),
	supportText: z.string().trim().max(300).optional(),
	rateLimitText: z.string().trim().max(200).optional(),
});

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const hostnameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.refine(
		(host) =>
			host.length <= 253 &&
			host.includes(".") &&
			host.split(".").every((label) => label.length <= 63 && LABEL.test(label)),
		"must be lowercase letters, digits, dots and hyphens, with at least one dot",
	);

const documentSchema = z.object({
	url: z
		.url()
		.max(2048)
		.refine((u) => u.startsWith("https://"), "must be an https URL"),
	title: z.string().trim().min(1),
	family: z.string().trim().min(1).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

// Passed to the API as is; the API validates the rest of the fields
const profileSchema = z.looseObject({ name: z.string().trim().min(1).max(100) });

export const packSchema = z.object({
	slug: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9-]+$/, "must use only a-z, 0-9 and -"),
	company: z.object({
		name: z.string().trim().min(1),
		website: z.url().optional(),
		supportPhone: z.string().optional(),
		supportEmail: z.string().optional(),
	}),
	profile: profileSchema,
	site: siteSchema.optional(),
	hostnames: z.array(hostnameSchema).default([]),
	monthlyCapUsd: z.number().positive().max(1_000_000).nullable().optional(),
	documents: z.array(documentSchema).default([]),
});

export type Pack = z.infer<typeof packSchema>;
export type PackDocument = Pack["documents"][number];

/** Parses pack.json text. The error names every bad field. */
export const parsePack = (text: string): Pack => {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		throw new Error(`pack.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, {
			cause: err,
		});
	}
	const parsed = packSchema.safeParse(raw);
	if (!parsed.success) {
		const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
		throw new Error(`pack.json is invalid:\n${lines.join("\n")}`);
	}
	return parsed.data;
};
