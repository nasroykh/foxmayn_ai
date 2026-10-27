import { useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import {
	IconUserPlus,
	IconTrash,
	IconLoader2,
	IconDots,
	IconUser,
	IconX,
} from "@tabler/icons-react";
import { orpc, type RouterOutputs } from "@/lib/orpc";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth";
import { errorMessage } from "@/lib/validation";
import { isOrgManager } from "@/lib/roles";
import { type Role, getRoleBadgeVariant } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type OrgMember = RouterOutputs["organization"]["listMembers"]["members"][number];

export function MembersTab() {
	const queryClient = useQueryClient();
	const { data: sessionData } = useSession();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const currentUserId = sessionData?.user?.id;

	const myRole = activeOrg?.members?.find(
		(m) => m.userId === currentUserId,
	)?.role;

	// Invite dialog state
	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<Role>("member");

	// Role update state
	const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
	// Member awaiting removal confirmation
	const [memberToRemove, setMemberToRemove] = useState<OrgMember | null>(null);

	const canManageMembers = isOrgManager(myRole);

	// Queries
	const orgQuery = useQuery(
		orpc.organization.getFullOrganization.queryOptions(),
	);

	const membersQuery = useQuery(orpc.organization.listMembers.queryOptions());

	const orgId = orgQuery.data?.id || null;
	const members: OrgMember[] = membersQuery.data?.members ?? [];
	const isLoading = orgQuery.isLoading || membersQuery.isLoading;

	const invitationsKey = ["org", "invitations", orgId] as const;
	const invitationsQuery = useQuery({
		queryKey: invitationsKey,
		enabled: canManageMembers && !!orgId,
		queryFn: async () => {
			const { data, error } = await authClient.organization.listInvitations({
				query: { organizationId: orgId! },
			});
			if (error) throw new Error(error.message || "Failed to load invitations");
			return (data ?? []).filter((i) => i.status === "pending");
		},
	});

	const cancelInvitationMutation = useMutation({
		mutationFn: async (invitationId: string) => {
			const { error } = await authClient.organization.cancelInvitation({
				invitationId,
			});
			if (error) throw new Error(error.message || "Failed to cancel invitation");
		},
		onSuccess: () => {
			toast.success("Invitation cancelled");
			void queryClient.invalidateQueries({ queryKey: invitationsKey });
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Failed to cancel invitation"));
		},
	});

	// Mutations
	const inviteMutation = useMutation(
		orpc.organization.inviteMember.mutationOptions({
			onSuccess: () => {
				toast.success(`Invitation sent to ${inviteEmail}`);
				setInviteOpen(false);
				setInviteEmail("");
				setInviteRole("member");
				void queryClient.invalidateQueries({ queryKey: invitationsKey });
			},
			onError: (error) => {
				toast.error(error.message || "Failed to send invitation");
			},
		}),
	);

	const updateRoleMutation = useMutation(
		orpc.organization.updateMemberRole.mutationOptions({
			onSuccess: () => {
				toast.success("Role updated successfully");
				void queryClient.invalidateQueries({
					queryKey: orpc.organization.listMembers.key(),
				});
				setUpdatingMemberId(null);
			},
			onError: (error) => {
				toast.error(error.message || "Failed to update role");
				setUpdatingMemberId(null);
			},
		}),
	);

	const removeMemberMutation = useMutation(
		orpc.organization.removeMember.mutationOptions({
			onSuccess: () => {
				toast.success("Member removed successfully");
				setMemberToRemove(null);
				void queryClient.invalidateQueries({
					queryKey: orpc.organization.listMembers.key(),
				});
			},
			onError: (error) => {
				toast.error(error.message || "Failed to remove member");
			},
		}),
	);

	const handleInvite = () => {
		if (!inviteEmail || !orgId) return;
		inviteMutation.mutate({
			email: inviteEmail,
			role: inviteRole,
			organizationId: orgId,
		});
	};

	const handleUpdateRole = (memberId: string, newRole: Role) => {
		if (!orgId) return;
		setUpdatingMemberId(memberId);
		updateRoleMutation.mutate({
			memberId,
			role: newRole,
			organizationId: orgId,
		});
	};

	const confirmRemoveMember = () => {
		if (!orgId || !memberToRemove) return;
		removeMemberMutation.mutate({
			memberIdOrEmail: memberToRemove.id,
			organizationId: orgId,
		});
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<div>
					<CardTitle>Team Members</CardTitle>
					<CardDescription>
						Manage who has access to this organization
					</CardDescription>
				</div>
				{canManageMembers && (
					<Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
						<DialogTrigger render={<Button className="gap-2" />}>
							<IconUserPlus className="size-4" />
							Invite Member
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Invite Team Member</DialogTitle>
								<DialogDescription>
									Send an email invitation to join your organization
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="invite-email">Email Address</Label>
									<Input
										id="invite-email"
										type="email"
										placeholder="colleague@example.com"
										value={inviteEmail}
										onChange={(e) => setInviteEmail(e.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="invite-role">Role</Label>
									<Select
										value={inviteRole}
										onValueChange={(v) => setInviteRole(v as Role)}
									>
										<SelectTrigger id="invite-role">
											<SelectValue>Select a role</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="member">Member</SelectItem>
											<SelectItem value="admin">Admin</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<DialogFooter>
								<Button variant="outline" onClick={() => setInviteOpen(false)}>
									Cancel
								</Button>
								<Button
									onClick={handleInvite}
									disabled={inviteMutation.isPending || !inviteEmail}
								>
									{inviteMutation.isPending && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
									Send Invitation
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Role</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.map((member) => (
								<TableRow key={member.id}>
									<TableCell>
										<div className="flex items-center gap-3">
											<Avatar className="size-8">
												<AvatarImage src={member.user.image || undefined} />
												<AvatarFallback className="text-[10px]">
													{member.user.name
														?.split(" ")
														.map((n) => n[0])
														.join("")
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
									<TableCell className="text-right">
										{canManageMembers &&
											member.role !== "owner" &&
											member.userId !== currentUserId && (
											<DropdownMenu>
												<DropdownMenuTrigger
													render={
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
															aria-label={`Actions for ${member.user.name}`}
														/>
													}
												>
													<IconDots className="size-4" />
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem disabled>
														<IconUser className="mr-2 size-4" />
														View Profile
													</DropdownMenuItem>
													{updatingMemberId === member.id ? (
														<DropdownMenuItem disabled>
															<IconLoader2 className="mr-2 size-4 animate-spin" />
															Updating...
														</DropdownMenuItem>
													) : (
														<>
															{member.role === "member" ? (
																<DropdownMenuItem
																	onClick={() =>
																		handleUpdateRole(member.id, "admin")
																	}
																>
																	Make Admin
																</DropdownMenuItem>
															) : (
																<DropdownMenuItem
																	onClick={() =>
																		handleUpdateRole(member.id, "member")
																	}
																>
																	Make Member
																</DropdownMenuItem>
															)}
														</>
													)}
													<DropdownMenuItem
														className="text-destructive focus:text-destructive"
														onClick={() => setMemberToRemove(member)}
													>
														<IconTrash className="mr-2 size-4" />
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

				{canManageMembers && (invitationsQuery.data?.length ?? 0) > 0 && (
					<div className="mt-8 space-y-3">
						<h3 className="text-sm font-semibold">Pending invitations</h3>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Email</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{invitationsQuery.data?.map((invitation) => (
									<TableRow key={invitation.id}>
										<TableCell>{invitation.email}</TableCell>
										<TableCell>
											<Badge variant={getRoleBadgeVariant(invitation.role)}>
												{invitation.role}
											</Badge>
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{format(new Date(invitation.expiresAt), "PP")}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="icon"
												className="size-8"
												aria-label={`Cancel invitation for ${invitation.email}`}
												disabled={cancelInvitationMutation.isPending}
												onClick={() =>
													cancelInvitationMutation.mutate(invitation.id)
												}
											>
												<IconX className="size-4" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>

			<AlertDialog
				open={memberToRemove !== null}
				onOpenChange={(open) => {
					if (!open) setMemberToRemove(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove member?</AlertDialogTitle>
						<AlertDialogDescription>
							{memberToRemove?.user.email} will lose access to this
							organization immediately.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeMemberMutation.isPending}
							onClick={confirmRemoveMember}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
