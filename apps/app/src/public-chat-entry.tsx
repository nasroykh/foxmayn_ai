import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PublicChat } from "@/components/public-chat";
import { ThemeProvider } from "@/components/theme-provider";
import type { PublicSiteInfo } from "@/lib/public-site";

/** Mounts the standalone chat of a public site. The signed-in app is never loaded. */
export function mountPublicChat(root: HTMLElement, site: PublicSiteInfo) {
	createRoot(root).render(
		<StrictMode>
			<ThemeProvider>
				<PublicChat site={site} />
			</ThemeProvider>
		</StrictMode>,
	);
}
