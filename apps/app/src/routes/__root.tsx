import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { createRootRoute, Outlet } from "@tanstack/react-router";

const RootLayout = () => {
	return (
		<ThemeProvider>
			<Outlet />
			<Toaster />
		</ThemeProvider>
	);
};

export const Route = createRootRoute({ component: RootLayout });
