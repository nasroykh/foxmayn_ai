import "./index.css";
import { fetchPublicSite } from "./lib/public-site";

// Which site is this? A hostname with a public site shows its standalone chat;
// anything else (404, error, timeout) is the normal app. The app code is only
// requested once no site is found, so a public site never downloads it.
const root = document.getElementById("root")!;

void (async () => {
	const site = await fetchPublicSite();
	if (site) {
		const { mountPublicChat } = await import("./public-chat-entry");
		mountPublicChat(root, site);
		return;
	}
	const { mountApp } = await import("./app-entry");
	mountApp(root);
})();
