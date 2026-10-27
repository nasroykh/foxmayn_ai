import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";
import {
	dropSessionState,
	queryClient,
	setUnauthorizedHandler,
} from "./lib/query-client";
import { DefaultError, DefaultNotFound } from "./components/route-fallbacks";

// Create a new router instance
const router = createRouter({
	routeTree,
	context: { queryClient, session: null },
	defaultErrorComponent: DefaultError,
	defaultNotFoundComponent: DefaultNotFound,
	defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
	interface StaticDataRouteOption {
		/** Shown in the layout header. */
		title?: string;
	}
}

// An expired session on any query/mutation sends the user back to login.
setUnauthorizedHandler(() => {
	const { pathname, search } = window.location;
	if (pathname.startsWith("/auth/")) return;
	void dropSessionState(() =>
		router.navigate({
			to: "/auth/login",
			search: { redirect: `${pathname}${search}` },
		}),
	);
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
