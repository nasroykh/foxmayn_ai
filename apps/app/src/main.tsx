import "./index.css";
import { fetchPublicSite } from "./lib/public-site";

// Which site is this? A hostname with a public site shows its standalone chat;
// anything else (404, error, timeout) is the normal app. The app code is
// requested at the same time as the answer, so the normal app waits for one
// request only.
const root = document.getElementById("root")!;
const appEntry = import("./app-entry");
// A public site never uses it: do not report its failure as unhandled
appEntry.catch(() => {});

void (async () => {
	const site = await fetchPublicSite();
	if (site) {
		const { mountPublicChat } = await import("./public-chat-entry");
		mountPublicChat(root, site);
		return;
	}
	const { mountApp } = await appEntry;
	mountApp(root);
})();
