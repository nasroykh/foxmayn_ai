import { Link, useLocation } from "@tanstack/react-router";
import {
	Home,
	Settings,
	LogOut,
	Sparkles,
	Sun,
	Moon,
	Monitor,
	Check,
} from "lucide-react";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { themeAtom, type Theme } from "@/atoms/global";
import { useAtom, useAtomValue } from "jotai";
import { authClient } from "@/lib/auth";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { userAtom } from "@/atoms/auth";

const navItems = [{ title: "Dashboard", icon: Home, href: "/" }];

export function AppSidebar() {
	const location = useLocation();
	const navigate = useNavigate();
	const $user = useAtomValue(userAtom);
	const [theme, setTheme] = useAtom(themeAtom);

	const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
		{ value: "light", label: "Light", icon: Sun },
		{ value: "dark", label: "Dark", icon: Moon },
		{ value: "system", label: "System", icon: Monitor },
	];

	const handleLogout = async () => {
		try {
			const res = await authClient.signOut();
			if (!res.data || res.error) {
				toast.error((res.error && res.error.message) || "Failed to logout");
				return;
			}
			navigate({ to: "/auth/login" });
		} catch (error) {
			console.error("Logout failed:", error);
			toast.error("Logout failed");
		}
	};

	return (
		<Sidebar collapsible="icon">
			{/* Logo Header */}
			<SidebarHeader className="">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<Link to="/">
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
									<Sparkles className="size-4" />
								</div>
								<div className="flex flex-col gap-0.5 leading-none">
									<span className="font-semibold">Acme Inc</span>
									<span className="text-xs text-muted-foreground">
										Dashboard
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			{/* Navigation */}
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{navItems.map((item) => (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton
										asChild={item.href !== "#"}
										isActive={
											item.href === "/"
												? location.pathname === item.href
												: location.pathname.startsWith(item.href)
										}
										tooltip={item.title}
									>
										{item.href !== "#" ? (
											<Link to={item.href}>
												<item.icon />
												<span>{item.title}</span>
											</Link>
										) : (
											<>
												<item.icon />
												<span>{item.title}</span>
											</>
										)}
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			{/* User Profile Footer */}
			<SidebarFooter className="border-t border-sidebar-border">
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<SidebarMenuButton size="lg">
									<Avatar className="size-8">
										<AvatarImage
											src={$user?.image || undefined}
											alt="User avatar"
										/>
										<AvatarFallback className="bg-primary/10 text-primary text-xs">
											{$user?.name
												?.split(" ")
												.map((n) => n[0])
												.join("")
												.toUpperCase()
												.slice(0, 2) || "U"}
										</AvatarFallback>
									</Avatar>
									<div className="flex flex-col gap-0.5 leading-none text-left">
										<span className="font-medium">{$user?.name || "User"}</span>
										<span className="text-xs text-muted-foreground">
											{$user?.email || ""}
										</span>
									</div>
								</SidebarMenuButton>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="start"
								className="w-[--radix-dropdown-menu-trigger-width]"
							>
								<DropdownMenuItem asChild>
									<Link to="/settings">
										<Settings className="mr-2 size-4" />
										Settings
									</Link>
								</DropdownMenuItem>
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<Sun className="mr-2 size-4" />
										Theme
									</DropdownMenuSubTrigger>
									<DropdownMenuPortal>
										<DropdownMenuSubContent>
											{themeOptions.map((option) => (
												<DropdownMenuItem
													key={option.value}
													onClick={() => setTheme(option.value)}
												>
													<option.icon className="mr-2 size-4" />
													{option.label}
													{theme === option.value && (
														<Check className="ml-auto size-4" />
													)}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuPortal>
								</DropdownMenuSub>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={handleLogout}>
									<LogOut className="mr-2 size-4" />
									Log out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
