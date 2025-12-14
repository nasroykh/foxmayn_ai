import { useAtom } from "jotai";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "../ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { roleAtom, tokenAtom, userAtom } from "@/atoms/auth";
import { authClient } from "@/lib/auth";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function Layout({
	children,
	hideHeader = false,
}: {
	children: React.ReactNode;
	hideHeader?: boolean;
}) {
	const [$user, setUser] = useAtom(userAtom);
	const [$role, setRole] = useAtom(roleAtom);
	const [$token, setToken] = useAtom(tokenAtom);

	useEffect(() => {
		const loadSession = async () => {
			const res = await authClient.getSession();

			if (!res.data || res.error) {
				return;
			}
			setUser(res.data.user);
			setToken(res.data.session.token);
			setRole(
				(res.data.user.role as "owner" | "admin" | "member") || undefined
			);
		};

		if ($user && $token && $role) return;
		loadSession();
	}, [$user, $token, $role]);

	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header
					className={cn(
						"flex h-14 shrink-0 items-center gap-4 px-4 bg-sidebar",
						{
							hidden: hideHeader,
						}
					)}
				>
					<SidebarTrigger className="-ml-1" />
					<span className="font-medium text-sm">Dashboard</span>
				</header>
				<main className="flex-1 overflow-auto">{children}</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
