import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import base from "./base.js";

/**
 * Shared flat config for the React + Vite + TanStack Router app.
 * Usage in `eslint.config.js`:
 *   export { default } from "@repo/eslint-config/react";
 */
export default defineConfig([
	...base,
	// Generated / vendored code: not linted.
	globalIgnores(["src/components/ui/**", "src/routeTree.gen.ts"]),
	{
		files: ["**/*.{ts,tsx}"],
		extends: [
			reactHooks.configs.flat["recommended-latest"],
			reactRefresh.configs.vite,
		],
		languageOptions: {
			globals: globals.browser,
		},
	},
	{
		// TanStack Router file routes export `Route` next to their component.
		files: ["src/routes/**/*.{ts,tsx}"],
		rules: {
			"react-refresh/only-export-components": [
				"warn",
				{ allowConstantExport: true, allowExportNames: ["Route"] },
			],
		},
	},
]);
