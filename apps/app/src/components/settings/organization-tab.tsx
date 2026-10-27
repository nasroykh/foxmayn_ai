import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
	FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconLoader2, IconCheck } from "@tabler/icons-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { useAuthActions } from "@/hooks/use-auth-actions";
import { useMemberRole } from "@/hooks/use-member-role";
import { errorMessage } from "@/lib/validation";

const orgSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	slug: z.string().min(2, "Slug must be at least 2 characters"),
});

type OrgFormValues = z.infer<typeof orgSchema>;

export function OrganizationTab() {
	const { data: activeOrg } = authClient.useActiveOrganization();
	const { data: organizations } = authClient.useListOrganizations();
	const { switchOrganization } = useAuthActions();
	const { isOwner } = useMemberRole();
	const [isSwitching, setIsSwitching] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const form = useForm<OrgFormValues>({
		resolver: zodResolver(orgSchema),
		// Re-evaluated by react-hook-form when the active organization changes
		values: activeOrg
			? { name: activeOrg.name, slug: activeOrg.slug }
			: undefined,
	});

	const onSubmit = async (values: OrgFormValues) => {
		setIsSaving(true);
		try {
			// Through the auth client so useActiveOrganization / useListOrganizations
			// pick up the new name immediately
			const { error } = await authClient.organization.update({
				data: { name: values.name, slug: values.slug },
			});
			if (error) {
				toast.error(error.message || "Failed to update organization");
				return;
			}
			toast.success("Organization updated successfully");
		} catch (error) {
			toast.error(errorMessage(error, "Failed to update organization"));
		} finally {
			setIsSaving(false);
		}
	};

	const handleSwitchOrganization = async (organizationId: string) => {
		if (organizationId === activeOrg?.id) return;

		setIsSwitching(true);
		try {
			await switchOrganization(organizationId);
			toast.success("Organization switched successfully");
		} catch (error) {
			toast.error(errorMessage(error, "Failed to switch organization"));
		} finally {
			setIsSwitching(false);
		}
	};

	return (
		<div className="space-y-6">
			{/* Organization Switcher */}
			{organizations && organizations.length > 1 && (
				<Card>
					<CardHeader>
						<CardTitle>Switch Organization</CardTitle>
						<CardDescription>
							Select which organization you want to work with
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid gap-2">
							{organizations.map((org) => {
								const isActive = org.id === activeOrg?.id;
								return (
									<button
										type="button"
										key={org.id}
										onClick={() => handleSwitchOrganization(org.id)}
										disabled={isSwitching || isActive}
										className={`flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent disabled:opacity-50 ${
											isActive ? "border-primary bg-accent" : ""
										}`}
									>
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<p className="font-medium">{org.name}</p>
												{isActive && (
													<Badge variant="default" className="gap-1">
														<IconCheck className="size-3" />
														Active
													</Badge>
												)}
											</div>
											<p className="text-sm text-muted-foreground">
												{org.slug}
											</p>
										</div>
										{isSwitching && !isActive && (
											<IconLoader2 className="size-4 animate-spin text-muted-foreground" />
										)}
									</button>
								);
							})}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Organization Settings */}
			<Card>
				<CardHeader>
					<CardTitle>Organization Settings</CardTitle>
					<CardDescription>
						Update your organization details and workspace settings
					</CardDescription>
				</CardHeader>
				<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Organization Name</FormLabel>
									<FormControl>
										<Input {...field} placeholder="Acme Inc." />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="slug"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Workspace Slug</FormLabel>
									<FormControl>
										<Input {...field} placeholder="acme-inc" />
									</FormControl>
									<FormDescription className="text-xs">
										The URL-friendly name for your workspace
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						{isOwner && (
							<div className="flex justify-end pt-2">
								<Button type="submit" disabled={isSaving}>
									{isSaving ? (
										<>
											<IconLoader2 className="mr-2 size-4 animate-spin" />
											Saving...
										</>
									) : (
										"Save Changes"
									)}
								</Button>
							</div>
						)}
					</form>
				</Form>
			</CardContent>
		</Card>
		</div>
	);
}
