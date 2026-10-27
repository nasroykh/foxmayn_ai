import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Shared flat config for Node/TypeScript workspaces (api, worker, packages).
 * Usage in a workspace `eslint.config.js`:
 *   export { default } from "@repo/eslint-config/base";
 */
export default defineConfig([
	globalIgnores([
		"**/dist/**",
		"**/node_modules/**",
		"**/drizzle/**",
		"**/.turbo/**",
		"**/coverage/**",
	]),
	{
		files: ["**/*.{ts,tsx,js,mjs,cjs}"],
		extends: [eslint.configs.recommended, tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2023,
			globals: globals.node,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
]);
