import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { themeAtom } from "@/atoms/global";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const theme = useAtomValue(themeAtom);

	useEffect(() => {
		const root = document.documentElement;

		const applyTheme = () => {
			if (theme === "dark") {
				root.classList.add("dark");
			} else if (theme === "light") {
				root.classList.remove("dark");
			} else {
				// System preference
				const prefersDark = window.matchMedia(
					"(prefers-color-scheme: dark)"
				).matches;
				if (prefersDark) {
					root.classList.add("dark");
				} else {
					root.classList.remove("dark");
				}
			}
		};

		applyTheme();

		// Listen for system preference changes when theme is "system"
		if (theme === "system") {
			const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
			const handler = () => applyTheme();
			mediaQuery.addEventListener("change", handler);
			return () => mediaQuery.removeEventListener("change", handler);
		}
	}, [theme]);

	return <>{children}</>;
}
