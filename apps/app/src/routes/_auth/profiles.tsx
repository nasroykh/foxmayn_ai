import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { Layout } from "@/components/layout/layout";
import { orpc } from "@/lib/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	IconPlus,
	IconDots,
	IconEdit,
	IconTrash,
	IconLoader2,
	IconBrain,
	IconStar,
} from "@tabler/icons-react";
import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
	ComboboxEmpty,
} from "@/components/ui/combobox";

export const Route = createFileRoute("/_auth/profiles")({
	component: ProfilesPage,
});

type ProfileFormValues = {
	name: string;
	description: string;
	model: string;
	embeddingModel: string;
	systemPrompt: string;
	chunkSize: number;
	chunkOverlap: number;
	topK: number;
	temperature: number;
	isDefault: boolean;
};

function ProfilesPage() {
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<any>(null);
	const [deletingProfileId, setDeletingProfileId] = useState<string | null>(
		null,
	);

	const { data: profilesData, isLoading } = useQuery(
		orpc.profiles.listProfiles.queryOptions({ input: { limit: 50 } }),
	);

	const createMutation = useMutation(
		orpc.profiles.createProfile.mutationOptions({
			onSuccess: () => {
				toast.success("Profile created");
				setIsCreateOpen(false);
				queryClient.invalidateQueries({
					queryKey: orpc.profiles.listProfiles.key(),
				});
			},
			onError: (err: any) =>
				toast.error(err.message || "Failed to create profile"),
		}),
	);

	const updateMutation = useMutation(
		orpc.profiles.updateProfile.mutationOptions({
			onSuccess: () => {
				toast.success("Profile updated");
				setEditingProfile(null);
				queryClient.invalidateQueries({
					queryKey: orpc.profiles.listProfiles.key(),
				});
			},
			onError: (err: any) =>
				toast.error(err.message || "Failed to update profile"),
		}),
	);

	const deleteMutation = useMutation(
		orpc.profiles.deleteProfile.mutationOptions({
			onSuccess: () => {
				toast.success("Profile deleted");
				setDeletingProfileId(null);
				queryClient.invalidateQueries({
					queryKey: orpc.profiles.listProfiles.key(),
				});
			},
			onError: (err: any) =>
				toast.error(err.message || "Failed to delete profile"),
		}),
	);

	const profiles = (profilesData as any)?.profiles ?? [];

	return (
		<Layout>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold">Profiles</h1>
						<p className="text-muted-foreground text-sm">
							Configure RAG pipeline settings for different use cases
						</p>
					</div>
					<Button onClick={() => setIsCreateOpen(true)} className="gap-2">
						<IconPlus className="size-4" />
						New Profile
					</Button>
				</div>

				{isLoading ? (
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{Array.from({ length: 3 }).map((_, i) => (
							<Card key={i}>
								<CardHeader>
									<Skeleton className="h-6 w-32" />
								</CardHeader>
								<CardContent>
									<Skeleton className="h-16 w-full" />
								</CardContent>
							</Card>
						))}
					</div>
				) : profiles.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
							<IconBrain className="size-12 opacity-30" />
							<p>No profiles yet. Create one to configure your RAG pipeline.</p>
							<Button variant="outline" onClick={() => setIsCreateOpen(true)}>
								<IconPlus className="size-4 mr-2" />
								Create Profile
							</Button>
						</CardContent>
					</Card>
				) : (
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{profiles.map((profile: any) => (
							<Card key={profile.id} className="relative">
								<CardHeader className="pb-2">
									<div className="flex items-start justify-between">
										<div className="flex items-center gap-2">
											<CardTitle className="text-base">
												{profile.name}
											</CardTitle>
											{profile.isDefault && (
												<Badge variant="secondary" className="gap-1 text-xs">
													<IconStar className="size-3" />
													Default
												</Badge>
											)}
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button
														variant="ghost"
														size="icon"
														className="size-7"
													/>
												}
											>
												<IconDots className="size-4" />
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem
													onClick={() => setEditingProfile(profile)}
												>
													<IconEdit className="mr-2 size-4" />
													Edit
												</DropdownMenuItem>
												{!profile.isDefault && (
													<DropdownMenuItem
														className="text-destructive focus:text-destructive"
														onClick={() => setDeletingProfileId(profile.id)}
													>
														<IconTrash className="mr-2 size-4" />
														Delete
													</DropdownMenuItem>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<CardDescription className="line-clamp-2">
										{profile.description || "No description"}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-1.5">
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">Model</span>
										<span className="font-mono">{profile.model}</span>
									</div>
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">Chunk size</span>
										<span>
											{profile.chunkSize} / overlap {profile.chunkOverlap}
										</span>
									</div>
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">Top-K</span>
										<span>{profile.topK}</span>
									</div>
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">Temperature</span>
										<span>{profile.temperature}</span>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<ProfileFormDialog
				open={isCreateOpen}
				title="Create Profile"
				onOpenChange={setIsCreateOpen}
				onSubmit={(values) => createMutation.mutate(values)}
				isPending={createMutation.isPending}
			/>

			{/* Edit Dialog */}
			{editingProfile && (
				<ProfileFormDialog
					open={!!editingProfile}
					title={`Edit: ${editingProfile.name}`}
					defaultValues={editingProfile}
					onOpenChange={(v) => !v && setEditingProfile(null)}
					onSubmit={(values) =>
						updateMutation.mutate({ id: editingProfile.id, data: values })
					}
					isPending={updateMutation.isPending}
				/>
			)}

			{/* Delete Confirm */}
			<AlertDialog
				open={!!deletingProfileId}
				onOpenChange={() => setDeletingProfileId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this profile?</AlertDialogTitle>
						<AlertDialogDescription>
							Documents linked to this profile will not be deleted, but the
							profile settings will be removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
							onClick={() =>
								deletingProfileId &&
								deleteMutation.mutate({ id: deletingProfileId })
							}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Layout>
	);
}

function ProfileFormDialog({
	open,
	title,
	defaultValues,
	onOpenChange,
	onSubmit,
	isPending,
}: {
	open: boolean;
	title: string;
	defaultValues?: Partial<ProfileFormValues>;
	onOpenChange: (v: boolean) => void;
	onSubmit: (values: any) => void;
	isPending: boolean;
}) {
	const { register, handleSubmit, control } = useForm<ProfileFormValues>({
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			model: defaultValues?.model,
			embeddingModel: defaultValues?.embeddingModel,
			systemPrompt: defaultValues?.systemPrompt ?? "",
			chunkSize: defaultValues?.chunkSize ?? 500,
			chunkOverlap: defaultValues?.chunkOverlap ?? 50,
			topK: defaultValues?.topK ?? 5,
			temperature: defaultValues?.temperature ?? 0.7,
			isDefault: defaultValues?.isDefault ?? false,
		},
	});

	const { data: llmModelsData } = useQuery(
		orpc.chat.getModels.queryOptions({ input: { type: "chat" } }),
	);
	const { data: embeddingModelsData } = useQuery(
		orpc.chat.getModels.queryOptions({ input: { type: "embedding" } }),
	);

	const llmModels = llmModelsData?.models ?? [];
	const embeddingModels = embeddingModelsData?.models ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl! max-h-[80dvh] overflow-y-auto pb-0">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						Configure the RAG pipeline settings
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2 space-y-2">
							<Label>Name *</Label>
							<Input {...register("name")} placeholder="My Profile" required />
						</div>
						<div className="col-span-2 space-y-2">
							<Label>Description</Label>
							<Input
								{...register("description")}
								placeholder="Optional description"
							/>
						</div>

						{/* LLM Model */}
						<div className="col-span-2 space-y-2">
							<Label>LLM Model</Label>
							<Controller
								name="model"
								control={control}
								render={({ field }) => (
									<Combobox
										value={field.value}
										onValueChange={(v) => field.onChange(v)}
										items={llmModels.map((m) => m.id)}
									>
										<ComboboxInput
											className="w-full"
											placeholder="Search LLM model..."
											showClear
										/>
										<ComboboxContent>
											<ComboboxEmpty>No models found</ComboboxEmpty>
											<ComboboxList>
												{(m: string) => (
													<ComboboxItem key={m} value={m}>
														{m}
													</ComboboxItem>
												)}
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								)}
							/>
						</div>

						{/* Embedding Model */}
						<div className="col-span-2 space-y-2">
							<Label>Embedding Model</Label>
							<Controller
								name="embeddingModel"
								control={control}
								render={({ field }) => (
									<Combobox
										value={field.value}
										onValueChange={(v) => field.onChange(v)}
										items={embeddingModels.map((m) => m.id)}
									>
										<ComboboxInput
											className="w-full"
											placeholder="Search embedding model..."
											showClear
										/>
										<ComboboxContent>
											<ComboboxEmpty>No models found</ComboboxEmpty>
											<ComboboxList>
												{(m: string) => (
													<ComboboxItem key={m} value={m}>
														{m}
													</ComboboxItem>
												)}
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								)}
							/>
						</div>

						<div className="space-y-2">
							<Label>Chunk Size</Label>
							<Input
								{...register("chunkSize", { valueAsNumber: true })}
								type="number"
							/>
						</div>
						<div className="space-y-2">
							<Label>Chunk Overlap</Label>
							<Input
								{...register("chunkOverlap", { valueAsNumber: true })}
								type="number"
							/>
						</div>
						<div className="space-y-2">
							<Label>Top-K Results</Label>
							<Input
								{...register("topK", { valueAsNumber: true })}
								type="number"
							/>
						</div>
						<div className="space-y-2">
							<Label>Temperature</Label>
							<Input
								{...register("temperature", { valueAsNumber: true })}
								type="number"
								step="0.1"
								min="0"
								max="2"
							/>
						</div>
						<div className="col-span-2 space-y-2">
							<Label>System Prompt</Label>
							<textarea
								{...register("systemPrompt")}
								className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
								placeholder="Optional system prompt..."
							/>
						</div>
						<div className="col-span-2 flex items-center gap-2">
							<input
								{...register("isDefault")}
								type="checkbox"
								id="isDefault"
								className="size-4"
							/>
							<Label htmlFor="isDefault">Set as default profile</Label>
						</div>
					</div>
					<DialogFooter className="pt-4">
						<Button
							variant="outline"
							type="button"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && (
								<IconLoader2 className="mr-2 size-4 animate-spin" />
							)}
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
