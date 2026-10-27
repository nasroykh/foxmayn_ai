import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Where `pnpm dev` forwards /api requests (the API's dev port).
const API_DEV_TARGET = "http://localhost:33450";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	// Load .env from the monorepo root (also picks up VITE_* from the process env).
	const env = loadEnv(mode, "../../", "VITE_");

	// Same-origin by default: in production Caddy proxies /api/* to the API,
	// in dev the proxy below does.
	const apiUrl = env.VITE_API_URL || "/api/v1";

	return {
		plugins: [
			tanstackRouter({
				target: "react",
				autoCodeSplitting: true,
			}),
			react(),
			tailwindcss(),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		envDir: "../../",
		define: {
			"import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
		},
		server: {
			port: 33460,
			proxy: {
				"/api": { target: API_DEV_TARGET, changeOrigin: false },
			},
		},
		preview: {
			port: 33460,
			proxy: {
				"/api": { target: API_DEV_TARGET, changeOrigin: false },
			},
		},
	};
});
