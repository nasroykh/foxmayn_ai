// Applies the saved theme before first paint (no flash). Loaded as a file,
// not inline, because the Content-Security-Policy forbids inline scripts.
// Mirrors themeAtom (src/atoms/global.ts) and ThemeProvider.
(function () {
	var theme = "system";
	try {
		theme = JSON.parse(localStorage.getItem("theme")) || "system";
	} catch {
		// Unreadable storage: keep "system".
	}
	var dark =
		theme === "dark" ||
		(theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	if (dark) document.documentElement.classList.add("dark");
})();
