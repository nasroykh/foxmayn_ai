import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconUser, IconBuilding, IconUsers } from "@tabler/icons-react";
import { ProfileTab } from "@/components/settings/profile-tab";
import { OrganizationTab } from "@/components/settings/organization-tab";
import { MembersTab } from "@/components/settings/members-tab";

export const Route = createFileRoute("/_auth/settings")({
	staticData: { title: "Settings" },
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
			<div className="flex items-center justify-between space-y-2">
				<h2 className="text-3xl font-bold tracking-tight">Settings</h2>
			</div>

			<Tabs defaultValue="profile" className="space-y-4">
				<TabsList className="bg-muted/50 p-1">
					<TabsTrigger value="profile" className="gap-2">
						<IconUser className="size-4" />
						Profile
					</TabsTrigger>
					<TabsTrigger value="organization" className="gap-2">
						<IconBuilding className="size-4" />
						Organization
					</TabsTrigger>
					<TabsTrigger value="members" className="gap-2">
						<IconUsers className="size-4" />
						Members
					</TabsTrigger>
				</TabsList>

				<TabsContent value="profile" className="space-y-4">
					<ProfileTab />
				</TabsContent>

				<TabsContent value="organization" className="space-y-4">
					<OrganizationTab />
				</TabsContent>

				<TabsContent value="members" className="space-y-4">
					<MembersTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}
