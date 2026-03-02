import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Layout } from "@/components/layout/layout";
import { orpc } from "@/lib/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import {
	IconPlus,
	IconTrash,
	IconCopy,
	IconCheck,
	IconLoader2,
	IconKey,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_auth/api-keys")({
	component: ApiKeysPage,
});

const createKeySchema = z.object({
	name: z.string().min(1, "Name is required"),
	prefix: z.string().optional(),
	expiresIn: z.number().optional(),
	remaining: z.number().optional(),
});

type CreateKeyValues = z.infer<typeof createKeySchema>;

function ApiKeysPage() {
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const { data: keys, isLoading } = useQuery(
		orpc.apikeys.listApiKeys.queryOptions({}),
	);

	const createMutation = useMutation(
		orpc.apikeys.createApiKey.mutationOptions({
			onSuccess: (data: any) => {
				setCreatedKey(data.key || data.token || null);
				setIsCreateOpen(false);
				queryClient.invalidateQueries({
					queryKey: orpc.apikeys.listApiKeys.key(),
				});
			},
			onError: (err: any) =>
				toast.error(err.message || "Failed to create API key"),
		}),
	);

	const deleteMutation = useMutation(
		orpc.apikeys.deleteApiKey.mutationOptions({
			onSuccess: () => {
				toast.success("API key deleted");
				setDeletingKeyId(null);
				queryClient.invalidateQueries({
					queryKey: orpc.apikeys.listApiKeys.key(),
				});
			},
			onError: (err: any) =>
				toast.error(err.message || "Failed to delete API key"),
		}),
	);

	const clearExpiredMutation = useMutation(
		orpc.apikeys.deleteAllExpiredApiKeys.mutationOptions({
			onSuccess: () => {
				toast.success("Expired keys cleared");
				queryClient.invalidateQueries({
					queryKey: orpc.apikeys.listApiKeys.key(),
				});
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const toggleMutation = useMutation(
		orpc.apikeys.updateApiKey.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.apikeys.listApiKeys.key(),
				});
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const form = useForm<CreateKeyValues>({
		resolver: zodResolver(createKeySchema),
		defaultValues: {
			name: "",
			prefix: "",
			expiresIn: undefined,
			remaining: undefined,
		},
	});

	const handleCopy = () => {
		if (createdKey) {
			navigator.clipboard.writeText(createdKey);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const keyList = Array.isArray(keys) ? keys : ((keys as any)?.keys ?? []);

	return (
		<Layout>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold">API Keys</h1>
						<p className="text-muted-foreground text-sm">
							Manage your API access keys
						</p>
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => clearExpiredMutation.mutate({})}
							disabled={clearExpiredMutation.isPending}
						>
							Clear Expired
						</Button>
						<Button onClick={() => setIsCreateOpen(true)} className="gap-2">
							<IconPlus className="size-4" />
							New Key
						</Button>
					</div>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Your API Keys</CardTitle>
						<CardDescription>
							Keys give programmatic access to the API. Keep them secret.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="rounded-md border border-input overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Prefix</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Uses Left</TableHead>
										<TableHead>Expires</TableHead>
										<TableHead>Created</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{isLoading ? (
										Array.from({ length: 3 }).map((_, i) => (
											<TableRow key={i}>
												{Array.from({ length: 7 }).map((_, j) => (
													<TableCell key={j}>
														<Skeleton className="h-4 w-full" />
													</TableCell>
												))}
											</TableRow>
										))
									) : keyList.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={7}
												className="h-24 text-center text-muted-foreground"
											>
												No API keys yet. Create one to get started.
											</TableCell>
										</TableRow>
									) : (
										keyList.map((key: any) => (
											<TableRow key={key.id}>
												<TableCell className="font-medium">
													{key.name || "—"}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{key.start || key.prefix || "—"}
												</TableCell>
												<TableCell>
													<button
														onClick={() =>
															toggleMutation.mutate({
																keyId: key.id,
																enabled: !key.enabled,
															})
														}
														className="cursor-pointer"
													>
														<Badge
															variant={
																key.enabled !== false ? "outline" : "secondary"
															}
															className={
																key.enabled !== false
																	? "text-emerald-600 border-emerald-200 bg-emerald-50"
																	: ""
															}
														>
															{key.enabled !== false ? "Enabled" : "Disabled"}
														</Badge>
													</button>
												</TableCell>
												<TableCell>{key.remaining ?? "Unlimited"}</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{key.expiresAt
														? format(new Date(key.expiresAt), "MMM d, yyyy")
														: "Never"}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{key.createdAt
														? format(new Date(key.createdAt), "MMM d, yyyy")
														: "—"}
												</TableCell>
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-destructive hover:text-destructive"
														onClick={() => setDeletingKeyId(key.id)}
													>
														<IconTrash className="size-4" />
													</Button>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Create Dialog */}
			<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create API Key</DialogTitle>
						<DialogDescription>
							The full key is shown only once after creation.
						</DialogDescription>
					</DialogHeader>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit((v) =>
								createMutation.mutate({
									name: v.name,
									prefix: v.prefix || undefined,
									expiresIn: v.expiresIn || undefined,
									remaining: v.remaining || undefined,
								}),
							)}
							className="space-y-4 py-4"
						>
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Key Name</FormLabel>
										<FormControl>
											<Input {...field} placeholder="My App Key" />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="prefix"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Prefix (optional)</FormLabel>
										<FormControl>
											<Input {...field} placeholder="myapp_" />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="grid grid-cols-2 gap-4">
								<FormField
									control={form.control}
									name="expiresIn"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Expires in (days)</FormLabel>
											<FormControl>
												<Input {...field} type="number" placeholder="30" />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="remaining"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Max uses</FormLabel>
											<FormControl>
												<Input
													{...field}
													type="number"
													placeholder="Unlimited"
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<DialogFooter className="pt-4">
								<Button
									variant="outline"
									type="button"
									onClick={() => setIsCreateOpen(false)}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={createMutation.isPending}>
									{createMutation.isPending && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
									Create Key
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>

			{/* Show Created Key Dialog */}
			<Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<IconKey className="size-5" />
							API Key Created
						</DialogTitle>
						<DialogDescription>
							Copy this key now. It will not be shown again.
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<div className="flex items-center gap-2 p-3 bg-muted rounded-md font-mono text-sm break-all">
							<span className="flex-1">{createdKey}</span>
							<Button
								variant="ghost"
								size="icon"
								className="shrink-0"
								onClick={handleCopy}
							>
								{copied ? (
									<IconCheck className="size-4 text-emerald-600" />
								) : (
									<IconCopy className="size-4" />
								)}
							</Button>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setCreatedKey(null)}>Done</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirm */}
			<AlertDialog
				open={!!deletingKeyId}
				onOpenChange={() => setDeletingKeyId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this API key?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. Any integrations using this key will
							stop working.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
							onClick={() =>
								deletingKeyId && deleteMutation.mutate({ keyId: deletingKeyId })
							}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete Key"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Layout>
	);
}
