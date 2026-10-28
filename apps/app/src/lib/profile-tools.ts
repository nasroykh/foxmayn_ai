// Mirror the tool limits in apps/api/src/utils/profile_tools.ts
export const MAX_TOOLS = 16;
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_PARAMETERS_BYTES = 8192;

const DEFAULT_PARAMETERS = JSON.stringify(
	{ type: "object", properties: {}, required: [] },
	null,
	2,
);

/** Form state of one tool: parameters stay text so half-typed JSON is kept. */
export type ToolDraft = {
	name: string;
	description: string;
	parameters: string;
	enabled: boolean;
};

export type ToolPayload = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	enabled: boolean;
};

export type ToolErrors = {
	name?: string;
	description?: string;
	parameters?: string;
};

export const emptyToolDraft = (): ToolDraft => ({
	name: "",
	description: "",
	parameters: DEFAULT_PARAMETERS,
	enabled: true,
});

export const toolsToDrafts = (
	tools: readonly ToolPayload[] | undefined,
): ToolDraft[] =>
	(tools ?? []).map((t) => ({
		name: t.name,
		description: t.description,
		parameters: JSON.stringify(t.parameters, null, 2),
		enabled: t.enabled,
	}));

function parseParameters(
	text: string,
): { value: Record<string, unknown> } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { error: "Invalid JSON" };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { error: "Parameters must be a JSON object" };
	}
	const value = parsed as Record<string, unknown>;
	if (value.type !== "object") {
		return { error: 'Parameters must have "type": "object"' };
	}
	if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_PARAMETERS_BYTES) {
		return { error: `Parameters must be at most ${MAX_PARAMETERS_BYTES} bytes` };
	}
	return { value };
}

/** Errors for every tool, by index. Empty objects mean the tool is valid. */
export function validateTools(tools: readonly ToolDraft[]): ToolErrors[] {
	const seen = new Map<string, number>();
	for (const t of tools) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
	return tools.map((t) => {
		const errors: ToolErrors = {};
		if (!TOOL_NAME_PATTERN.test(t.name)) {
			errors.name =
				"Start with a letter; use letters, digits and _ only (max 64)";
		} else if ((seen.get(t.name) ?? 0) > 1) {
			errors.name = "Name must be unique";
		}
		const description = t.description.trim();
		if (description.length < 1) errors.description = "Description is required";
		else if (description.length > MAX_DESCRIPTION_LENGTH) {
			errors.description = `At most ${MAX_DESCRIPTION_LENGTH} characters`;
		}
		const parsed = parseParameters(t.parameters);
		if ("error" in parsed) errors.parameters = parsed.error;
		return errors;
	});
}

export const hasToolErrors = (tools: readonly ToolDraft[]): boolean =>
	tools.length > MAX_TOOLS ||
	validateTools(tools).some((e) => Object.keys(e).length > 0);

/** Drafts to the API payload. Call only after validation passed. */
export const draftsToTools = (tools: readonly ToolDraft[]): ToolPayload[] =>
	tools.map((t) => {
		const parsed = parseParameters(t.parameters);
		return {
			name: t.name,
			description: t.description.trim(),
			parameters: "value" in parsed ? parsed.value : {},
			enabled: t.enabled,
		};
	});
