import { Link, useLocation } from "@tanstack/react-router";
import {
	IconHome,
	IconSettings,
	IconLogout,
	IconSparkles,
	IconSun,
	IconMoon,
	IconDeviceDesktop,
	IconCheck,
	IconBuilding,
	IconMessage,
	IconFileText,
	IconBrain,
	IconKey,
	IconCoins,
	IconUsers,
} from "@tabler/icons-react";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
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
import { useAtom } from "jotai";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { authClient, type User } from "@/lib/auth";

const mainNavItems = [
	{ title: "Dashboard", icon: IconHome, href: "/" },
	{ title: "Chat", icon: IconMessage, href: "/chat" },
	{ title: "Documents", icon: IconFileText, href: "/documents" },
	{ title: "Profiles", icon: IconBrain, href: "/profiles" },
];

const accountNavItems = [
	{ title: "API Keys", icon: IconKey, href: "/api-keys" },
	{ title: "Credits", icon: IconCoins, href: "/credits" },
	{ title: "Settings", icon: IconSettings, href: "/settings" },
];

const adminNavItems = [
	{ title: "Users", icon: IconUsers, href: "/admin/users" },
];

function NavItem({ item }: { item: { title: string; icon: React.ElementType; href: string } }) {
	const location = useLocation();
	const isActive =
		item.href === "/"
			? location.pathname === item.href
			: location.pathname.startsWith(item.href);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton render={<Link to={item.href} />} isActive={isActive}>
				<item.icon />
				<span>{item.title}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function AppSidebar({ user }: { user?: User | null }) {
	const navigate = useNavigate();
	const [theme, setTheme] = useAtom(themeAtom);
	const { data: activeOrg } = authClient.useActiveOrganization();
	const { data: organizations } = authClient.useListOrganizations();
	const isAdmin = user?.role === "admin";

	const themeOptions: { value: Theme; label: string; icon: typeof IconSun }[] =
		[
			{ value: "light", label: "Light", icon: IconSun },
			{ value: "dark", label: "Dark", icon: IconMoon },
			{ value: "system", label: "System", icon: IconDeviceDesktop },
		];

	const handleSwitchOrganization = async (organizationId: string) => {
		if (organizationId === activeOrg?.id) return;

		try {
			await authClient.organization.setActive({ organizationId });
			await authClient.getSession();
			toast.success("Organization switched successfully");
		} catch (error: any) {
			toast.error(error.message || "Failed to switch organization");
		}
	};

	const handleLogout = async () => {
		try {
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => navigate({ to: "/auth/login" }),
				},
			});
		} catch (error: any) {
			console.error("Logout failed:", error);
			toast.error(error.message || "Logout failed");
		}
	};

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" render={<Link to="/" />}>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
								<IconSparkles className="size-4" />
							</div>
							<div className="flex flex-col gap-0.5 leading-none">
								<span className="font-semibold">Foxmayn AI</span>
								<span className="text-xs text-muted-foreground">Platform</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Main</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{mainNavItems.map((item) => (
								<NavItem key={item.href} item={item} />
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>Account</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{accountNavItems.map((item) => (
								<NavItem key={item.href} item={item} />
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				{isAdmin && (
					<SidebarGroup>
						<SidebarGroupLabel>Admin</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{adminNavItems.map((item) => (
									<NavItem key={item.href} item={item} />
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>

			<SidebarFooter className="border-t border-sidebar-border">
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<SidebarMenuButton size="lg">
										<Avatar className="size-8">
											<AvatarImage src={user?.image || undefined} alt="User avatar" />
											<AvatarFallback className="bg-primary/10 text-primary text-xs">
												{user?.name
													?.split(" ")
													.map((n) => n[0])
													.join("")
													.toUpperCase()
													.slice(0, 2) || "U"}
											</AvatarFallback>
										</Avatar>
										<div className="flex flex-col gap-0.5 leading-none text-left">
											<span className="font-medium">{user?.name || "User"}</span>
											<span className="text-xs text-muted-foreground">{user?.email || ""}</span>
										</div>
									</SidebarMenuButton>
								}
							/>
							<DropdownMenuContent className="w-56" side="bottom" align="center">
								<DropdownMenuItem render={<Link to="/settings" />}>
									<IconSettings className="mr-2 size-4" />
									Settings
								</DropdownMenuItem>
								{organizations && organizations.length > 1 && (
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>
											<IconBuilding className="mr-2 size-4" />
											Organization
										</DropdownMenuSubTrigger>
										<DropdownMenuPortal>
											<DropdownMenuSubContent>
												{organizations.map((org) => (
													<DropdownMenuItem
														key={org.id}
														onClick={() => handleSwitchOrganization(org.id)}
													>
														<IconBuilding className="mr-2 size-4" />
														<span className="flex-1 truncate">{org.name}</span>
														{activeOrg?.id === org.id && (
															<IconCheck className="ml-2 size-4" />
														)}
													</DropdownMenuItem>
												))}
											</DropdownMenuSubContent>
										</DropdownMenuPortal>
									</DropdownMenuSub>
								)}
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<IconSun className="mr-2 size-4" />
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
														<IconCheck className="ml-auto size-4" />
													)}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuPortal>
								</DropdownMenuSub>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={handleLogout}>
									<IconLogout className="mr-2 size-4" />
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
