import { createHash } from "node:crypto";
import { Ajv, type ValidateFunction } from "ajv";
import { z } from "zod";
import type { ProfileTool } from "@repo/db";

/**
 * Tools of a RAG profile: functions the model may call. The API client runs
 * them and sends the results back (POST /chat/continue). Definitions come only
 * from the profile, never from a chat request.
 */

export const MAX_PROFILE_TOOLS = 16;
export const MAX_TOOL_PARAMETERS_BYTES = 8 * 1024;
export const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
// Larger arguments are refused before validation (keeps checks like uniqueItems cheap)
export const MAX_TOOL_ARGUMENTS_CHARS = 16_000;

// Keywords whose regular expressions would run tenant input on our CPU (ReDoS)
const REJECTED_KEYWORDS = ["pattern", "patternProperties"] as const;

/**
 * A fresh validator per tool set, so `$id`s of one profile never reach
 * another. Hardened for tenant-written schemas:
 * - strict: unknown keywords fail when the profile is saved
 * - no loadSchema: a remote `$ref` cannot be resolved and fails to compile
 * - $data stays off (default); formats are annotations only, not checked
 * - pattern / patternProperties are removed, so they fail as unknown keywords
 */
const createAjv = (): Ajv => {
	const ajv = new Ajv({
		strict: true,
		allErrors: true,
		validateFormats: false,
		addUsedSchema: false,
	});
	for (const keyword of REJECTED_KEYWORDS) ajv.removeKeyword(keyword);
	return ajv;
};

/** Compile error as a message a profile editor can act on. */
const describeCompileError = (error: unknown): string => {
	const message = error instanceof Error ? error.message : String(error);
	if (REJECTED_KEYWORDS.some((k) => message.includes(`"${k}"`))) {
		return "pattern and patternProperties are not supported (the server does not run regular expressions from tool schemas)";
	}
	return message.replace(/^strict mode: /, "");
};

/** Compiles a parameters schema. Returns the error message, or null when valid. */
export const parametersSchemaError = (
	parameters: Record<string, unknown>,
): string | null => {
	if (parameters.type !== "object") return 'parameters must have type "object"';
	if (Buffer.byteLength(JSON.stringify(parameters)) > MAX_TOOL_PARAMETERS_BYTES) {
		return `parameters must be at most ${MAX_TOOL_PARAMETERS_BYTES} bytes as JSON`;
	}
	try {
		createAjv().compile(parameters);
		return null;
	} catch (error) {
		return describeCompileError(error);
	}
};

export const profileToolSchema = z
	.object({
		name: z
			.string()
			.regex(
				TOOL_NAME_PATTERN,
				"Tool names start with a letter and use only letters, digits and _ (max 64)",
			),
		description: z.string().trim().min(1).max(1024),
		parameters: z.record(z.string(), z.unknown()),
		enabled: z.boolean(),
	})
	.superRefine((tool, ctx) => {
		const error = parametersSchemaError(tool.parameters);
		if (error) ctx.addIssue({ code: "custom", message: error, path: ["parameters"] });
	});

/** A profile's tools, validated as a whole on every write (full replace). */
export const profileToolsSchema = z
	.array(profileToolSchema)
	.max(MAX_PROFILE_TOOLS)
	.superRefine((tools, ctx) => {
		const seen = new Set<string>();
		tools.forEach((tool, i) => {
			if (seen.has(tool.name)) {
				ctx.addIssue({
					code: "custom",
					message: `Duplicate tool name: ${tool.name}`,
					path: [i, "name"],
				});
			}
			seen.add(tool.name);
		});
	});

/** What the model sees of a tool (also the snapshot kept for a continuation). */
export type ToolSpec = Pick<ProfileTool, "name" | "description" | "parameters">;

export const enabledTools = (tools: ProfileTool[] | null | undefined): ToolSpec[] =>
	(tools ?? [])
		.filter((t) => t.enabled)
		.map(({ name, description, parameters }) => ({ name, description, parameters }));

// ============================================================================
// Argument validation
// ============================================================================

const MAX_CACHED_TOOL_SETS = 500;
// Compiled validators per tool set, keyed by a hash of the definitions
const validatorCache = new Map<string, Map<string, ValidateFunction>>();

const toolSetKey = (tools: ToolSpec[]): string =>
	createHash("sha256").update(JSON.stringify(tools)).digest("hex");

/** Validators of a tool set, compiled once per distinct set of definitions. */
const validatorsFor = (tools: ToolSpec[]): Map<string, ValidateFunction> => {
	const key = toolSetKey(tools);
	const cached = validatorCache.get(key);
	if (cached) {
		// Re-insert: the Map keeps insertion order, so the oldest entry goes first
		validatorCache.delete(key);
		validatorCache.set(key, cached);
		return cached;
	}
	const ajv = createAjv();
	const validators = new Map(tools.map((t) => [t.name, ajv.compile(t.parameters)]));
	validatorCache.set(key, validators);
	if (validatorCache.size > MAX_CACHED_TOOL_SETS) {
		validatorCache.delete(validatorCache.keys().next().value!);
	}
	return validators;
};

export type ToolCallCheck =
	| { ok: true; arguments: Record<string, unknown> }
	| { ok: false; error: { error: string; details: string } };

/**
 * Checks a call the model made: known enabled tool, JSON arguments, schema.
 * The error is sent back to the model, so it never echoes the arguments.
 */
export const checkToolCall = (
	tools: ToolSpec[],
	name: string,
	rawArguments: string,
): ToolCallCheck => {
	const validate = validatorsFor(tools).get(name);
	if (!validate) {
		return {
			ok: false,
			error: { error: "unknown_tool", details: `No tool named ${name} is available` },
		};
	}
	if (rawArguments.length > MAX_TOOL_ARGUMENTS_CHARS) {
		return {
			ok: false,
			error: {
				error: "invalid_arguments",
				details: `Arguments are longer than ${MAX_TOOL_ARGUMENTS_CHARS} characters`,
			},
		};
	}
	let args: unknown;
	try {
		args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
	} catch {
		return {
			ok: false,
			error: { error: "invalid_arguments", details: "Arguments are not valid JSON" },
		};
	}
	if (!validate(args)) {
		const details = (validate.errors ?? [])
			.map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`)
			.join("; ");
		return { ok: false, error: { error: "invalid_arguments", details } };
	}
	return { ok: true, arguments: args as Record<string, unknown> };
};
