import { Outlet, useMatches, useRouteContext } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "../ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth";
import { useAuthActions } from "@/hooks/use-auth-actions";
import { errorMessage } from "@/lib/validation";
import { toast } from "sonner";

/** Rendered once by the `_auth` route; pages render inside the `<Outlet />`. */
export function Layout() {
	const { data: sessionData } = useSession();
	const context = useRouteContext({ from: "/_auth" });
	const user = sessionData?.user ?? context.session?.user;
	const { stopImpersonation } = useAuthActions();
	const impersonatedBy = (sessionData ?? context.session)?.session
		?.impersonatedBy;

	const title = useMatches({
		select: (matches) =>
			[...matches].reverse().find((m) => m.staticData?.title)?.staticData
				.title,
	});

	return (
		<SidebarProvider>
			<AppSidebar user={user} />
			<SidebarInset>
				{impersonatedBy && (
					<div
						role="status"
						className="flex items-center justify-between gap-4 bg-amber-500/15 px-4 py-2 text-sm"
					>
						<span>You are impersonating {user?.email}.</span>
						<Button
							size="sm"
							variant="outline"
							onClick={async () => {
								try {
									await stopImpersonation();
								} catch (error) {
									toast.error(errorMessage(error, "Failed to stop impersonating"));
								}
							}}
						>
							Stop impersonating
						</Button>
					</div>
				)}
				<header className="flex h-14 shrink-0 items-center gap-4 px-4 bg-sidebar">
					<SidebarTrigger className="-ml-1" />
					<span className="font-medium text-sm">{title ?? "Foxmayn AI"}</span>
				</header>
				<main className="flex-1 overflow-auto p-4">
					<Outlet />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
