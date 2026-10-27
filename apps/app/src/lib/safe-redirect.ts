/**
 * Returns `target` only when it is a same-origin path ("/invite/abc"), so a
 * `?redirect=` search param can never send the user to another site.
 */
export function safeRedirect(target: unknown): string | undefined {
	if (typeof target !== "string") return undefined;
	if (!target.startsWith("/")) return undefined;
	// "//evil.com" and "/\evil.com" are protocol-relative / normalised to hosts
	if (target.startsWith("//") || target.startsWith("/\\")) return undefined;
	for (let i = 0; i < target.length; i++) {
		if (target.charCodeAt(i) < 0x20) return undefined;
	}
	// Never bounce back into the auth screens
	if (target.startsWith("/auth/")) return undefined;
	return target;
}

export function validateRedirectSearch(search: Record<string, unknown>): {
	redirect?: string;
} {
	const redirect = safeRedirect(search.redirect);
	return redirect ? { redirect } : {};
}
