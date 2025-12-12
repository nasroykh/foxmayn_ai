import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
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
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
	User,
	Building2,
	Users,
	UserPlus,
	MoreHorizontal,
	Trash2,
	ShieldCheck,
	Loader2,
	Mail,
} from "lucide-react";
import { authClient } from "@/lib/auth";
import { toast } from "sonner";
import { Layout } from "@/components/layout/layout";
import { roleAtom, userAtom } from "@/atoms/auth";
import { useAtomValue } from "jotai";

export const Route = createFileRoute("/_auth/settings")({
	component: SettingsPage,
});

// Schemas
const profileSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.string().email("Invalid email address"),
});

const orgSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	slug: z.string().min(2, "Slug must be at least 2 characters"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;
type OrgFormValues = z.infer<typeof orgSchema>;

type Member = {
	id: string;
	userId: string;
	role: string;
	createdAt: Date;
	user: {
		id: string;
		name: string;
		email: string;
		image?: string | null;
	};
};

const ROLES = ["owner", "admin", "member"] as const;
type Role = (typeof ROLES)[number];

function getRoleBadgeVariant(role: string) {
	switch (role) {
		case "owner":
			return "default";
		case "admin":
			return "secondary";
		default:
			return "outline";
	}
}

function SettingsPage() {
	return (
		<Layout>
			<div className="space-y-6">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Settings</h1>
					<p className="text-muted-foreground">
						Manage your account and organization settings
					</p>
				</div>

				<Tabs defaultValue="profile" className="space-y-6">
					<TabsList>
						<TabsTrigger value="profile" className="gap-2">
							<User className="size-4" />
							Profile
						</TabsTrigger>
						<TabsTrigger value="organization" className="gap-2">
							<Building2 className="size-4" />
							Organization
						</TabsTrigger>
						<TabsTrigger value="members" className="gap-2">
							<Users className="size-4" />
							Members
						</TabsTrigger>
					</TabsList>

					<TabsContent value="profile">
						<ProfileTab />
					</TabsContent>

					<TabsContent value="organization">
						<OrganizationTab />
					</TabsContent>

					<TabsContent value="members">
						<MembersTab />
					</TabsContent>
				</Tabs>
			</div>
		</Layout>
	);
}

// Profile Tab Component
function ProfileTab() {
	const $user = useAtomValue(userAtom);
	const [isSaving, setIsSaving] = useState(false);
	const [userImage, setUserImage] = useState<string | null>(null);

	const form = useForm<ProfileFormValues>({
		resolver: zodResolver(profileSchema),
		defaultValues: {
			name: "",
			email: "",
		},
	});

	useEffect(() => {
		if (!$user) return;

		form.reset({
			name: $user.name,
			email: $user.email,
		});
		setUserImage($user.image || null);
	}, [$user]);

	const onSubmit = async (values: ProfileFormValues) => {
		setIsSaving(true);
		try {
			const res = await authClient.updateUser({
				name: values.name,
			});

			if (res.error) {
				toast.error(res.error.message || "Failed to update profile");
				return;
			}

			toast.success("Profile updated successfully");
		} catch (error) {
			console.error("Failed to update profile:", error);
			toast.error("Failed to update profile");
		} finally {
			setIsSaving(false);
		}
	};

	if (!$user) {
		return (
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-32" />
					<Skeleton className="h-4 w-56" />
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex items-center gap-4">
						<Skeleton className="size-20 rounded-full" />
						<div className="space-y-2">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-48" />
						</div>
					</div>
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-24" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile</CardTitle>
				<CardDescription>Update your personal information</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						{/* Avatar Section */}
						<div className="flex items-center gap-4">
							<Avatar className="size-20">
								<AvatarImage src={userImage || undefined} />
								<AvatarFallback className="bg-primary/10 text-primary text-lg">
									{form
										.watch("name")
										?.split(" ")
										.map((n) => n[0])
										.join("")
										.toUpperCase()
										.slice(0, 2) || "U"}
								</AvatarFallback>
							</Avatar>
							<div>
								<p className="font-medium">{form.watch("name")}</p>
								<p className="text-sm text-muted-foreground">
									{form.watch("email")}
								</p>
							</div>
						</div>

						<Separator />

						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Full Name</FormLabel>
									<FormControl>
										<Input
											placeholder="John Doe"
											{...field}
											disabled={isSaving}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input
											placeholder="john@example.com"
											type="email"
											{...field}
											disabled
										/>
									</FormControl>
									<p className="text-xs text-muted-foreground">
										Email cannot be changed
									</p>
								</FormItem>
							)}
						/>

						<Button type="submit" disabled={isSaving}>
							{isSaving ? (
								<>
									<Loader2 className="mr-2 size-4 animate-spin" />
									Saving...
								</>
							) : (
								"Save Changes"
							)}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}

// Organization Tab Component
function OrganizationTab() {
	const $role = useAtomValue(roleAtom);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [orgId, setOrgId] = useState<string | null>(null);

	console.log($role);

	const form = useForm<OrgFormValues>({
		resolver: zodResolver(orgSchema),
		defaultValues: {
			name: "",
			slug: "",
		},
	});

	useEffect(() => {
		const loadOrganization = async () => {
			try {
				const { data } = await authClient.organization.getFullOrganization();
				if (data) {
					setOrgId(data.id);
					form.reset({
						name: data.name,
						slug: data.slug,
					});
				}
			} catch (error) {
				console.error("Failed to load organization:", error);
				toast.error("Failed to load organization");
			} finally {
				setIsLoading(false);
			}
		};

		loadOrganization();
	}, [form]);

	const onSubmit = async (values: OrgFormValues) => {
		if (!orgId) return;

		setIsSaving(true);
		try {
			const res = await authClient.organization.update({
				organizationId: orgId,
				data: {
					name: values.name,
					slug: values.slug,
				},
			});

			if (res.error) {
				toast.error(res.error.message || "Failed to update organization");
				return;
			}

			toast.success("Organization updated successfully");
		} catch (error) {
			console.error("Failed to update organization:", error);
			toast.error("Failed to update organization");
		} finally {
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-32" />
					<Skeleton className="h-4 w-56" />
				</CardHeader>
				<CardContent className="space-y-4">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-24" />
				</CardContent>
			</Card>
		);
	}

	if (!orgId) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12 text-center">
					<Building2 className="size-12 text-muted-foreground mb-4" />
					<h2 className="text-lg font-semibold mb-2">No Organization Found</h2>
					<p className="text-muted-foreground text-sm">
						You don't have an active organization.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Organization</CardTitle>
				<CardDescription>
					Update your organization's basic information
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
										<Input
											placeholder="My Organization"
											{...field}
											disabled={isSaving || $role !== "owner"}
										/>
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
									<FormLabel>Slug</FormLabel>
									<FormControl>
										<Input
											placeholder="my-organization"
											{...field}
											disabled={isSaving || $role !== "owner"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{$role === "owner" && (
							<Button type="submit" disabled={isSaving || $role !== "owner"}>
								{isSaving ? (
									<>
										<Loader2 className="mr-2 size-4 animate-spin" />
										Saving...
									</>
								) : (
									"Save Changes"
								)}
							</Button>
						)}
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}

// Members Tab Component
function MembersTab() {
	const $role = useAtomValue(roleAtom);
	const [members, setMembers] = useState<Member[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [orgId, setOrgId] = useState<string | null>(null);

	// Invite dialog state
	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<Role>("member");
	const [isInviting, setIsInviting] = useState(false);

	// Role update state
	const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);

	// Delete state
	const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);

	const canManageMembers = $role === "owner" || $role === "admin";

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		setIsLoading(true);
		try {
			const orgRes = await authClient.organization.getFullOrganization();
			if (orgRes.data) {
				setOrgId(orgRes.data.id);
			}

			const membersRes = await authClient.organization.listMembers();
			if (membersRes.data?.members) {
				setMembers(membersRes.data.members as Member[]);
			}
		} catch (error) {
			console.error("Failed to load data:", error);
			toast.error("Failed to load members");
		} finally {
			setIsLoading(false);
		}
	};

	const handleInvite = async () => {
		if (!inviteEmail || !orgId) return;

		setIsInviting(true);
		try {
			const res = await authClient.organization.inviteMember({
				email: inviteEmail,
				role: inviteRole,
				organizationId: orgId,
			});

			if (res.error) {
				toast.error(res.error.message || "Failed to send invitation");
				return;
			}

			toast.success(`Invitation sent to ${inviteEmail}`);
			setInviteOpen(false);
			setInviteEmail("");
			setInviteRole("member");
		} catch (error) {
			console.error("Failed to invite:", error);
			toast.error("Failed to send invitation");
		} finally {
			setIsInviting(false);
		}
	};

	const handleUpdateRole = async (memberId: string, newRole: Role) => {
		if (!orgId) return;

		setUpdatingMemberId(memberId);
		try {
			const res = await authClient.organization.updateMemberRole({
				memberId,
				role: newRole,
				organizationId: orgId,
			});

			if (res.error) {
				toast.error(res.error.message || "Failed to update role");
				return;
			}

			setMembers((prev) =>
				prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
			);
			toast.success("Role updated successfully");
		} catch (error) {
			console.error("Failed to update role:", error);
			toast.error("Failed to update role");
		} finally {
			setUpdatingMemberId(null);
		}
	};

	const handleRemoveMember = async (memberId: string, email: string) => {
		if (!orgId) return;

		setDeletingMemberId(memberId);
		try {
			const res = await authClient.organization.removeMember({
				memberIdOrEmail: email,
				organizationId: orgId,
			});

			if (res.error) {
				toast.error(res.error.message || "Failed to remove member");
				return;
			}

			setMembers((prev) => prev.filter((m) => m.id !== memberId));
			toast.success("Member removed successfully");
		} catch (error) {
			console.error("Failed to remove member:", error);
			toast.error("Failed to remove member");
		} finally {
			setDeletingMemberId(null);
		}
	};

	if (isLoading) {
		return (
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<Skeleton className="h-6 w-32 mb-2" />
						<Skeleton className="h-4 w-48" />
					</div>
					<Skeleton className="h-10 w-32" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{[1, 2, 3].map((i) => (
							<div key={i} className="flex items-center gap-4">
								<Skeleton className="size-10 rounded-full" />
								<div className="flex-1">
									<Skeleton className="h-4 w-32 mb-1" />
									<Skeleton className="h-3 w-48" />
								</div>
								<Skeleton className="h-6 w-16" />
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!orgId) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12 text-center">
					<Users className="size-12 text-muted-foreground mb-4" />
					<h2 className="text-lg font-semibold mb-2">No Organization Found</h2>
					<p className="text-muted-foreground text-sm">
						You don't have an active organization.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<div>
					<CardTitle>Team Members</CardTitle>
					<CardDescription>
						{members.length} member{members.length !== 1 ? "s" : ""} in your
						organization
					</CardDescription>
				</div>

				{canManageMembers && (
					<Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={canManageMembers}>
								<UserPlus className="mr-2 size-4" />
								Invite
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Invite Member</DialogTitle>
								<DialogDescription>
									Send an invitation to join your organization
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<label className="text-sm font-medium">Email</label>
									<div className="relative">
										<Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
										<Input
											placeholder="user@example.com"
											type="email"
											value={inviteEmail}
											onChange={(e) => setInviteEmail(e.target.value)}
											className="pl-10"
											disabled={isInviting}
										/>
									</div>
								</div>
								<div className="space-y-2">
									<label className="text-sm font-medium">Role</label>
									<Select
										value={inviteRole}
										onValueChange={(v) => setInviteRole(v as Role)}
										disabled={isInviting}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="member">Member</SelectItem>
											<SelectItem value="admin">Admin</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<DialogFooter>
								<Button
									variant="outline"
									onClick={() => setInviteOpen(false)}
									disabled={isInviting}
								>
									Cancel
								</Button>
								<Button
									onClick={handleInvite}
									disabled={!inviteEmail || isInviting}
								>
									{isInviting ? (
										<>
											<Loader2 className="mr-2 size-4 animate-spin" />
											Sending...
										</>
									) : (
										"Send Invitation"
									)}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</CardHeader>
			<CardContent>
				{members.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<Users className="size-10 text-muted-foreground mb-3" />
						<p className="text-muted-foreground">No members yet</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Member</TableHead>
								<TableHead>Role</TableHead>
								<TableHead className="w-[50px]"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.map((member) => (
								<TableRow key={member.id}>
									<TableCell>
										<div className="flex items-center gap-3">
											<Avatar className="size-9">
												<AvatarImage
													src={member.user.image || undefined}
													alt={member.user.name}
												/>
												<AvatarFallback className="bg-primary/10 text-primary text-xs">
													{member.user.name
														.split(" ")
														.map((n) => n[0])
														.join("")
														.toUpperCase()
														.slice(0, 2)}
												</AvatarFallback>
											</Avatar>
											<div>
												<p className="font-medium">{member.user.name}</p>
												<p className="text-sm text-muted-foreground">
													{member.user.email}
												</p>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<Badge variant={getRoleBadgeVariant(member.role)}>
											{member.role}
										</Badge>
									</TableCell>
									<TableCell>
										{canManageMembers && member.role !== "owner" && (
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														className="size-8"
														disabled={
															updatingMemberId === member.id ||
															deletingMemberId === member.id
														}
													>
														{updatingMemberId === member.id ||
														deletingMemberId === member.id ? (
															<Loader2 className="size-4 animate-spin" />
														) : (
															<MoreHorizontal className="size-4" />
														)}
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													{member.role === "member" && (
														<DropdownMenuItem
															onClick={() =>
																handleUpdateRole(member.id, "admin")
															}
														>
															<ShieldCheck className="mr-2 size-4" />
															Make Admin
														</DropdownMenuItem>
													)}
													{member.role === "admin" && (
														<DropdownMenuItem
															onClick={() =>
																handleUpdateRole(member.id, "member")
															}
														>
															<ShieldCheck className="mr-2 size-4" />
															Make Member
														</DropdownMenuItem>
													)}
													<DropdownMenuItem
														className="text-destructive focus:text-destructive"
														onClick={() =>
															handleRemoveMember(member.id, member.user.email)
														}
													>
														<Trash2 className="mr-2 size-4" />
														Remove
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
