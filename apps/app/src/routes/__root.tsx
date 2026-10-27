import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { sessionQueryOptions } from "@/lib/query-client";
import type { SessionData } from "@/lib/auth";

type RouterContext = {
	queryClient: QueryClient;
	session: SessionData;
};

const RootLayout = () => {
	return (
		<ThemeProvider>
			<Outlet />
			<Toaster />
		</ThemeProvider>
	);
};

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async ({ context }) => {
		// Cached: only hits the network on first load and after login, logout or
		// org switch cleared the cache.
		try {
			const session = await context.queryClient.ensureQueryData(
				sessionQueryOptions,
			);
			return { session };
		} catch {
			context.queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
			return { session: null };
		}
	},
	component: RootLayout,
});
