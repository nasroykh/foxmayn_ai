import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Layout } from "@/components/layout/layout";
import { orpc } from "@/lib/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
} from "@/components/ui/dialog";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	IconPlus,
	IconSearch,
	IconDots,
	IconUser,
	IconKey,
	IconGhost,
	IconBan,
	IconTrash,
	IconChecks,
	IconShieldCheck,
	IconLoader2,
	IconChevronLeft,
	IconChevronRight,
	IconDevices,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_auth/admin/users")({
	beforeLoad: async ({ context }) => {
		if (context.session?.user?.role !== "admin") {
			throw redirect({ to: "/" });
		}
	},
	component: AdminUsersPage,
});

function AdminUsersPage() {
	const queryClient = useQueryClient();
	const [limit] = useState(10);
	const [offset, setOffset] = useState(0);
	const [searchValue, setSearchValue] = useState("");
	const [searchField, setSearchField] = useState<"name" | "email">("name");
	const [selectedIds, setSelectedIds] = useState<string[]>([]);

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<any>(null);
	const [passwordUser, setPasswordUser] = useState<any>(null);
	const [banningUser, setBanningUser] = useState<any>(null);
	const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
	const [sessionsUser, setSessionsUser] = useState<any>(null);
	const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
	const [isBulkRoleOpen, setIsBulkRoleOpen] = useState(false);
	const [isBulkBanOpen, setIsBulkBanOpen] = useState(false);

	const { data, isLoading } = useQuery(
		orpc.users.listUsers.queryOptions({
			input: {
				limit,
				offset,
				searchValue: searchValue || undefined,
				searchField,
				searchOperator: "contains",
			},
		}),
	);

	const invalidateUsers = () =>
		queryClient.invalidateQueries({ queryKey: orpc.users.listUsers.key() });

	const deleteMutation = useMutation(
		orpc.users.deleteUser.mutationOptions({
			onSuccess: () => {
				toast.success("User deleted");
				setDeletingUserId(null);
				invalidateUsers();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const unbanMutation = useMutation(
		orpc.users.unbanUser.mutationOptions({
			onSuccess: () => {
				toast.success("User unbanned");
				invalidateUsers();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const impersonateMutation = useMutation(
		orpc.users.impersonateUser.mutationOptions({
			onSuccess: (d: any) => {
				toast.success(`Impersonating ${d.user?.name}`);
				window.location.reload();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const bulkDeleteMutation = useMutation(
		orpc.users.bulkDeleteUsers.mutationOptions({
			onSuccess: (res: any) => {
				toast.success(res.message);
				setSelectedIds([]);
				setIsBulkDeleteOpen(false);
				invalidateUsers();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const bulkRoleMutation = useMutation(
		orpc.users.bulkSetUserRole.mutationOptions({
			onSuccess: (res: any) => {
				toast.success(res.message);
				setSelectedIds([]);
				setIsBulkRoleOpen(false);
				invalidateUsers();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const bulkBanMutation = useMutation(
		orpc.users.bulkBanUsers.mutationOptions({
			onSuccess: (res: any) => {
				toast.success(res.message);
				setSelectedIds([]);
				setIsBulkBanOpen(false);
				invalidateUsers();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const users = (data as any)?.users ?? [];
	const total = (data as any)?.total ?? 0;

	const toggleSelect = (id: string) =>
		setSelectedIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);

	const toggleAll = () =>
		setSelectedIds(
			selectedIds.length === users.length ? [] : users.map((u: any) => u.id),
		);

	return (
		<Layout>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold">Users</h1>
						<p className="text-muted-foreground text-sm">
							Manage all system users
						</p>
					</div>
					<Button onClick={() => setIsCreateOpen(true)} className="gap-2">
						<IconPlus className="size-4" />
						New User
					</Button>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>All Users</CardTitle>
						<CardDescription>{total} total users</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex gap-3 mb-4">
							<div className="relative flex-1">
								<IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
								<Input
									className="pl-10"
									placeholder="Search users..."
									value={searchValue}
									onChange={(e) => {
										setSearchValue(e.target.value);
										setOffset(0);
									}}
								/>
							</div>
							<Select
								value={searchField}
								onValueChange={(v: any) => setSearchField(v)}
							>
								<SelectTrigger className="w-32">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="name">Name</SelectItem>
									<SelectItem value="email">Email</SelectItem>
								</SelectContent>
							</Select>
							{selectedIds.length > 0 && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={<Button variant="outline" className="gap-2" />}
									>
										<IconChecks className="size-4" />
										Bulk ({selectedIds.length})
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => setIsBulkRoleOpen(true)}>
											<IconShieldCheck className="mr-2 size-4" />
											Change Role
										</DropdownMenuItem>
										<DropdownMenuItem onClick={() => setIsBulkBanOpen(true)}>
											<IconBan className="mr-2 size-4" />
											Ban Users
										</DropdownMenuItem>
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onClick={() => setIsBulkDeleteOpen(true)}
										>
											<IconTrash className="mr-2 size-4" />
											Delete Users
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</div>

						<div className="rounded-md border border-input overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-10">
											<Checkbox
												checked={
													users.length > 0 &&
													selectedIds.length === users.length
												}
												onCheckedChange={toggleAll}
											/>
										</TableHead>
										<TableHead>User</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Joined</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{isLoading ? (
										Array.from({ length: 5 }).map((_, i) => (
											<TableRow key={i}>
												{Array.from({ length: 6 }).map((_, j) => (
													<TableCell key={j}>
														<Skeleton className="h-4 w-full" />
													</TableCell>
												))}
											</TableRow>
										))
									) : users.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={6}
												className="h-24 text-center text-muted-foreground"
											>
												No users found
											</TableCell>
										</TableRow>
									) : (
										users.map((user: any) => (
											<TableRow key={user.id}>
												<TableCell>
													<Checkbox
														checked={selectedIds.includes(user.id)}
														onCheckedChange={() => toggleSelect(user.id)}
													/>
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-3">
														<Avatar className="size-8">
															<AvatarImage src={user.image} />
															<AvatarFallback className="text-xs">
																{user.name?.[0]?.toUpperCase()}
															</AvatarFallback>
														</Avatar>
														<div>
															<p className="font-medium text-sm">{user.name}</p>
															<p className="text-xs text-muted-foreground">
																{user.email}
															</p>
														</div>
													</div>
												</TableCell>
												<TableCell>
													<Badge
														variant={
															user.role === "admin" ? "default" : "secondary"
														}
														className="capitalize"
													>
														{user.role}
													</Badge>
												</TableCell>
												<TableCell>
													{user.banned ? (
														<Badge variant="destructive">Banned</Badge>
													) : (
														<Badge
															variant="outline"
															className="text-emerald-600 border-emerald-200 bg-emerald-50"
														>
															Active
														</Badge>
													)}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{user.createdAt
														? format(new Date(user.createdAt), "MMM d, yyyy")
														: "—"}
												</TableCell>
												<TableCell className="text-right">
													<DropdownMenu>
														<DropdownMenuTrigger
															render={
																<Button
																	variant="ghost"
																	size="icon"
																	className="size-8"
																/>
															}
														>
															<IconDots className="size-4" />
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end" className="w-44">
															<DropdownMenuItem
																onClick={() => setEditingUser(user)}
															>
																<IconUser className="mr-2 size-4" />
																Edit
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() => setPasswordUser(user)}
															>
																<IconKey className="mr-2 size-4" />
																Reset Password
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() => setSessionsUser(user)}
															>
																<IconDevices className="mr-2 size-4" />
																Sessions
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() =>
																	impersonateMutation.mutate({
																		userId: user.id,
																	})
																}
															>
																<IconGhost className="mr-2 size-4" />
																Impersonate
															</DropdownMenuItem>
															<Separator className="my-1" />
															{user.banned ? (
																<DropdownMenuItem
																	onClick={() =>
																		unbanMutation.mutate({ userId: user.id })
																	}
																>
																	<IconShieldCheck className="mr-2 size-4" />
																	Unban
																</DropdownMenuItem>
															) : (
																<DropdownMenuItem
																	className="text-orange-600 focus:text-orange-600"
																	onClick={() => setBanningUser(user)}
																>
																	<IconBan className="mr-2 size-4" />
																	Ban
																</DropdownMenuItem>
															)}
															<DropdownMenuItem
																className="text-destructive focus:text-destructive"
																onClick={() => setDeletingUserId(user.id)}
															>
																<IconTrash className="mr-2 size-4" />
																Delete
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>

						{!isLoading && total > limit && (
							<div className="flex items-center justify-between mt-4">
								<p className="text-sm text-muted-foreground">
									{offset + 1}–{Math.min(offset + limit, total)} of {total}
								</p>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										disabled={offset === 0}
										onClick={() => setOffset(Math.max(0, offset - limit))}
									>
										<IconChevronLeft className="size-4" />
										Previous
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={offset + limit >= total}
										onClick={() => setOffset(offset + limit)}
									>
										Next
										<IconChevronRight className="size-4" />
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Create User Dialog */}
			<CreateUserDialog
				open={isCreateOpen}
				setOpen={setIsCreateOpen}
				onSuccess={invalidateUsers}
			/>

			{/* Edit User Dialog */}
			{editingUser && (
				<EditUserDialog
					open={!!editingUser}
					setOpen={(v) => !v && setEditingUser(null)}
					user={editingUser}
					onSuccess={invalidateUsers}
				/>
			)}

			{/* Reset Password Dialog */}
			{passwordUser && (
				<ResetPasswordDialog
					open={!!passwordUser}
					setOpen={(v) => !v && setPasswordUser(null)}
					user={passwordUser}
				/>
			)}

			{/* Ban User Dialog */}
			{banningUser && (
				<BanUserDialog
					open={!!banningUser}
					setOpen={(v) => !v && setBanningUser(null)}
					user={banningUser}
					onSuccess={invalidateUsers}
				/>
			)}

			{/* Sessions Dialog */}
			{sessionsUser && (
				<SessionsDialog
					open={!!sessionsUser}
					setOpen={(v) => !v && setSessionsUser(null)}
					user={sessionsUser}
				/>
			)}

			{/* Delete Confirm */}
			<AlertDialog
				open={!!deletingUserId}
				onOpenChange={() => setDeletingUserId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this user?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes the user account and all their data.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
							onClick={() =>
								deletingUserId &&
								deleteMutation.mutate({ userId: deletingUserId })
							}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Bulk Delete */}
			<AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Delete {selectedIds.length} users?
						</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={bulkDeleteMutation.isPending}
							onClick={() =>
								bulkDeleteMutation.mutate({ userIds: selectedIds })
							}
						>
							{bulkDeleteMutation.isPending ? "Deleting..." : "Delete All"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Bulk Role */}
			<BulkRoleDialog
				open={isBulkRoleOpen}
				setOpen={setIsBulkRoleOpen}
				userIds={selectedIds}
				mutation={bulkRoleMutation}
			/>

			{/* Bulk Ban */}
			<BulkBanDialog
				open={isBulkBanOpen}
				setOpen={setIsBulkBanOpen}
				userIds={selectedIds}
				mutation={bulkBanMutation}
			/>
		</Layout>
	);
}

function CreateUserDialog({
	open,
	setOpen,
	onSuccess,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	onSuccess: () => void;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [role, setRole] = useState<"user" | "admin">("user");

	const mutation = useMutation(
		orpc.users.createUser.mutationOptions({
			onSuccess: () => {
				toast.success("User created");
				setOpen(false);
				setName("");
				setEmail("");
				setPassword("");
				setRole("user");
				onSuccess();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create User</DialogTitle>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label>Name</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Jane Doe"
						/>
					</div>
					<div className="space-y-2">
						<Label>Email</Label>
						<Input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="jane@example.com"
						/>
					</div>
					<div className="space-y-2">
						<Label>Password</Label>
						<Input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Min 8 characters"
						/>
					</div>
					<div className="space-y-2">
						<Label>Role</Label>
						<Select value={role} onValueChange={(v: any) => setRole(v)}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="user">User</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={
							!name || !email || password.length < 8 || mutation.isPending
						}
						onClick={() => mutation.mutate({ name, email, password, role })}
					>
						{mutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Create
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EditUserDialog({
	open,
	setOpen,
	user,
	onSuccess,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	user: any;
	onSuccess: () => void;
}) {
	const [name, setName] = useState(user.name);
	const [email, setEmail] = useState(user.email);

	const updateMutation = useMutation(
		orpc.users.updateUser.mutationOptions({
			onSuccess: () => {
				toast.success("User updated");
				setOpen(false);
				onSuccess();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const roleMutation = useMutation(
		orpc.users.setUserRole.mutationOptions({
			onSuccess: () => {
				toast.success("Role updated");
				onSuccess();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit {user.name}</DialogTitle>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label>Name</Label>
						<Input value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="space-y-2">
						<Label>Email</Label>
						<Input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>
					<Button
						className="w-full"
						disabled={updateMutation.isPending}
						onClick={() =>
							updateMutation.mutate({ userId: user.id, data: { name, email } })
						}
					>
						{updateMutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Update Profile
					</Button>
					<Separator />
					<div className="space-y-2">
						<Label>Role</Label>
						<Select
							defaultValue={Array.isArray(user.role) ? user.role[0] : user.role}
							onValueChange={(v) =>
								roleMutation.mutate({ userId: user.id, role: v as any })
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="user">User</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ResetPasswordDialog({
	open,
	setOpen,
	user,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	user: any;
}) {
	const [password, setPassword] = useState("");
	const mutation = useMutation(
		orpc.users.setUserPassword.mutationOptions({
			onSuccess: () => {
				toast.success("Password reset");
				setOpen(false);
				setPassword("");
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Reset Password for {user.name}</DialogTitle>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label>New Password</Label>
						<Input
							type="password"
							placeholder="Min 8 characters"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={password.length < 8 || mutation.isPending}
						onClick={() =>
							mutation.mutate({ userId: user.id, newPassword: password })
						}
					>
						{mutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Reset
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function BanUserDialog({
	open,
	setOpen,
	user,
	onSuccess,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	user: any;
	onSuccess: () => void;
}) {
	const [reason, setReason] = useState("");
	const mutation = useMutation(
		orpc.users.banUser.mutationOptions({
			onSuccess: () => {
				toast.success("User banned");
				setOpen(false);
				onSuccess();
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="text-destructive">
						Ban {user.name}
					</DialogTitle>
					<DialogDescription>
						The user will be immediately logged out and blocked.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label>Reason (optional)</Label>
						<textarea
							className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							placeholder="Reason for ban..."
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={mutation.isPending}
						onClick={() =>
							mutation.mutate({ userId: user.id, banReason: reason })
						}
					>
						{mutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Ban User
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SessionsDialog({
	open,
	setOpen,
	user,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	user: any;
}) {
	const queryClient = useQueryClient();

	const { data: sessions, isLoading } = useQuery({
		...orpc.users.listUserSessions.queryOptions({ input: { userId: user.id } }),
		enabled: open,
	});

	const revokeMutation = useMutation(
		orpc.users.revokeSession.mutationOptions({
			onSuccess: () => {
				toast.success("Session revoked");
				queryClient.invalidateQueries({
					queryKey: orpc.users.listUserSessions.key(),
				});
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const revokeAllMutation = useMutation(
		orpc.users.revokeAllUserSessions.mutationOptions({
			onSuccess: () => {
				toast.success("All sessions revoked");
				queryClient.invalidateQueries({
					queryKey: orpc.users.listUserSessions.key(),
				});
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const sessionList = Array.isArray(sessions)
		? sessions
		: ((sessions as any)?.sessions ?? []);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Sessions for {user.name}</DialogTitle>
					<DialogDescription>
						{sessionList.length} active session(s)
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2 py-4 max-h-64 overflow-y-auto">
					{isLoading ? (
						Array.from({ length: 3 }).map((_, i) => (
							<Skeleton key={i} className="h-12 w-full" />
						))
					) : sessionList.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-4">
							No active sessions
						</p>
					) : (
						sessionList.map((s: any) => (
							<div
								key={s.id}
								className="flex items-center justify-between p-2 bg-muted/40 rounded-md"
							>
								<div>
									<p className="text-xs font-mono text-muted-foreground">
										{s.token?.slice(0, 16)}...
									</p>
									<p className="text-xs text-muted-foreground">
										{s.createdAt
											? format(new Date(s.createdAt), "MMM d, HH:mm")
											: "—"}
									</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									onClick={() =>
										revokeMutation.mutate({ sessionToken: s.token })
									}
								>
									Revoke
								</Button>
							</div>
						))
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Close
					</Button>
					<Button
						variant="destructive"
						disabled={sessionList.length === 0 || revokeAllMutation.isPending}
						onClick={() => revokeAllMutation.mutate({ userId: user.id })}
					>
						{revokeAllMutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Revoke All
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function BulkRoleDialog({
	open,
	setOpen,
	userIds,
	mutation,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	userIds: string[];
	mutation: any;
}) {
	const [role, setRole] = useState<"user" | "admin">("user");
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Change Role for {userIds.length} users</DialogTitle>
				</DialogHeader>
				<div className="py-4">
					<Select value={role} onValueChange={(v: any) => setRole(v)}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="user">User</SelectItem>
							<SelectItem value="admin">Admin</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={mutation.isPending}
						onClick={() => mutation.mutate({ userIds, role })}
					>
						{mutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Update
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function BulkBanDialog({
	open,
	setOpen,
	userIds,
	mutation,
}: {
	open: boolean;
	setOpen: (v: boolean) => void;
	userIds: string[];
	mutation: any;
}) {
	const [reason, setReason] = useState("");
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Ban {userIds.length} users?</DialogTitle>
				</DialogHeader>
				<div className="py-4">
					<textarea
						className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						placeholder="Optional ban reason..."
						value={reason}
						onChange={(e) => setReason(e.target.value)}
					/>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate({ userIds, banReason: reason })}
					>
						{mutation.isPending && (
							<IconLoader2 className="mr-2 size-4 animate-spin" />
						)}
						Ban All
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
