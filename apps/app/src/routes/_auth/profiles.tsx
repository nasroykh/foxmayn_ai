import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { orpc, type RouterInputs, type RouterOutputs } from "@/lib/orpc";
import { errorMessage } from "@/lib/validation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
	staticData: { title: "Profiles" },
	component: ProfilesPage,
});

type Profile = RouterOutputs["profiles"]["listProfiles"]["profiles"][number];
type CreateProfileInput = RouterInputs["profiles"]["createProfile"];
type ModelInfo = RouterOutputs["chat"]["getModels"]["models"][number];

const DEFAULT_CHAT_MODEL = "anthropic/claude-haiku-5.5";

// Mirror PROFILE_REASONING_EFFORTS and the reasoning limits in
// apps/api/src/utils/profile_schema.ts
const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";
// Claude's smallest thinking budget: the token limit must be above it
const MIN_REASONING_BUDGET_TOKENS = 1024;
// Below this, thinking may leave too little room for the answer
const LOW_ANSWER_ROOM_TOKENS = 1536;

const toReasoningEffort = (value: string | undefined): ReasoningEffort =>
	REASONING_EFFORTS.find((e) => e === value) ?? DEFAULT_REASONING_EFFORT;

// Bounds mirror apps/api/src/utils/profile_schema.ts
const profileFormSchema = z
	.object({
		name: z.string().trim().min(1, "Name is required").max(100),
		description: z.string().max(1000),
		model: z.string().optional(),
		embeddingModel: z.string().optional(),
		systemPrompt: z.string().max(8000, "At most 8000 characters"),
		language: z.string().trim().min(1, "Language is required").max(50),
		chunkSize: z.coerce
			.number("Enter a number")
			.int("Whole number")
			.min(100, "At least 100")
			.max(4000, "At most 4000"),
		chunkOverlap: z.coerce
			.number("Enter a number")
			.int("Whole number")
			.min(0, "At least 0"),
		topK: z.coerce
			.number("Enter a number")
			.int("Whole number")
			.min(1, "At least 1")
			.max(50, "At most 50"),
		temperature: z.coerce
			.number("Enter a number")
			.min(0, "At least 0")
			.max(2, "At most 2"),
		scoreThreshold: z.coerce
			.number("Enter a number")
			.min(0, "At least 0")
			.max(1, "At most 1"),
		reasoningEffort: z.enum(REASONING_EFFORTS),
		maxTokens: z.coerce
			.number("Enter a number")
			.int("Whole number")
			.min(1, "At least 1")
			.max(32000, "At most 32000"),
		isDefault: z.boolean(),
	})
	.refine((v) => v.chunkOverlap < v.chunkSize, {
		message: "Overlap must be smaller than the chunk size",
		path: ["chunkOverlap"],
	})
	.refine(
		(v) =>
			v.reasoningEffort === "none" ||
			v.maxTokens > MIN_REASONING_BUDGET_TOKENS,
		{
			message: `With reasoning on, use more than ${MIN_REASONING_BUDGET_TOKENS}`,
			path: ["maxTokens"],
		},
	);

type ProfileFormInput = z.input<typeof profileFormSchema>;
type ProfileFormValues = z.output<typeof profileFormSchema>;

const formatPrice = (usd: number) =>
	`$${usd > 0 && usd < 0.01 ? usd.toPrecision(2) : usd.toFixed(2)}`;

const formatContext = (tokens: number) =>
	tokens >= 1_000_000
		? `${Number((tokens / 1_000_000).toFixed(1))}M`
		: `${Math.round(tokens / 1000)}K`;

/** Every word of the query must appear in the model's id or name. */
function matchesModel(
	model: ModelInfo | undefined,
	id: string,
	query: string,
): boolean {
	const haystack = `${id} ${model?.name ?? ""}`.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.every((word) => haystack.includes(word));
}

/** Combobox row: name, id, price per 1M tokens (in / out) and context. */
function ModelOption({ id, model }: { id: string; model?: ModelInfo }) {
	return (
		<ComboboxItem value={id}>
			<div className="flex min-w-0 flex-col">
				<span className="truncate">{model?.name ?? id}</span>
				<span className="text-muted-foreground truncate text-xs">
					{model?.name !== id && <span className="font-mono">{id} · </span>}
					{model &&
						`${formatPrice(model.inputPrice)} in / ${formatPrice(model.outputPrice)} out per 1M · ${formatContext(model.contextLength)} context`}
				</span>
			</div>
		</ComboboxItem>
	);
}

/** Form values to the API payload (empty model fields keep the server default). */
function toPayload(values: ProfileFormValues): CreateProfileInput {
	return {
		name: values.name,
		description: values.description,
		// The model combobox only offers ids from chat.getModels; the API
		// re-validates them
		model: (values.model || undefined) as CreateProfileInput["model"],
		embeddingModel: (values.embeddingModel ||
			undefined) as CreateProfileInput["embeddingModel"],
		systemPrompt: values.systemPrompt,
		language: values.language,
		chunkSize: values.chunkSize,
		chunkOverlap: values.chunkOverlap,
		topK: values.topK,
		temperature: values.temperature,
		scoreThreshold: values.scoreThreshold,
		reasoningEffort: values.reasoningEffort,
		maxTokens: values.maxTokens,
		isDefault: values.isDefault,
	};
}

function ProfilesPage() {
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
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
				void queryClient.invalidateQueries({
					queryKey: orpc.profiles.listProfiles.key(),
				});
			},
			onError: (err) =>
				toast.error(errorMessage(err, "Failed to create profile")),
		}),
	);

	const updateMutation = useMutation(
		orpc.profiles.updateProfile.mutationOptions({
			onSuccess: (data) => {
				toast.success(
					data.reindexingDocuments > 0
						? `Profile updated. Re-indexing ${data.reindexingDocuments} document${data.reindexingDocuments === 1 ? "" : "s"} with the new embedding model.`
						: "Profile updated",
				);
				void queryClient.invalidateQueries({
					queryKey: orpc.documents.key(),
				});
				setEditingProfile(null);
				void queryClient.invalidateQueries({
					queryKey: orpc.profiles.listProfiles.key(),
				});
			},
			onError: (err) =>
				toast.error(errorMessage(err, "Failed to update profile")),
		}),
	);

	const deleteMutation = useMutation(
		orpc.profiles.deleteProfile.mutationOptions({
			onSuccess: () => {
				toast.success("Profile deleted");
				setDeletingProfileId(null);
				void queryClient.invalidateQueries({
					queryKey: orpc.profiles.listProfiles.key(),
				});
			},
			onError: (err) =>
				toast.error(errorMessage(err, "Failed to delete profile")),
		}),
	);

	const profiles: Profile[] = profilesData?.profiles ?? [];

	return (
		<>
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
						{profiles.map((profile) => (
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
														aria-label={`Actions for ${profile.name}`}
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
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">Reasoning</span>
										<span>
											{profile.reasoningEffort} / {profile.maxTokens} tokens
										</span>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>

			{/* Create Dialog (mounted only while open so every open starts blank) */}
			{isCreateOpen && (
				<ProfileFormDialog
					open
					title="Create Profile"
					onOpenChange={setIsCreateOpen}
					onSubmit={(values) => createMutation.mutate(toPayload(values))}
					isPending={createMutation.isPending}
				/>
			)}

			{/* Edit Dialog */}
			{editingProfile && (
				<ProfileFormDialog
					open={!!editingProfile}
					title={`Edit: ${editingProfile.name}`}
					defaultValues={editingProfile}
					onOpenChange={(v) => !v && setEditingProfile(null)}
					onSubmit={(values) =>
						updateMutation.mutate({
							id: editingProfile.id,
							data: toPayload(values),
						})
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
		</>
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
	defaultValues?: Profile;
	onOpenChange: (v: boolean) => void;
	onSubmit: (values: ProfileFormValues) => void;
	isPending: boolean;
}) {
	const {
		register,
		handleSubmit,
		control,
		formState: { errors },
	} = useForm<ProfileFormInput, unknown, ProfileFormValues>({
		resolver: zodResolver(profileFormSchema),
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			// New profiles start on the API default (DEFAULT_CHAT_MODEL in
			// apps/api/src/services/model-catalog.service.ts); reasoning defaults to low there
			model: defaultValues?.model ?? DEFAULT_CHAT_MODEL,
			embeddingModel: defaultValues?.embeddingModel ?? undefined,
			systemPrompt: defaultValues?.systemPrompt ?? "",
			language: defaultValues?.language ?? "auto",
			chunkSize: defaultValues?.chunkSize ?? 500,
			chunkOverlap: defaultValues?.chunkOverlap ?? 50,
			topK: defaultValues?.topK ?? 5,
			temperature: defaultValues?.temperature ?? 0.7,
			scoreThreshold: defaultValues?.scoreThreshold ?? 0.3,
			reasoningEffort: toReasoningEffort(defaultValues?.reasoningEffort),
			maxTokens: defaultValues?.maxTokens ?? 2048,
			isDefault: defaultValues?.isDefault ?? false,
		},
	});

	// Thinking shares the token limit with the answer
	const reasoningEffort = useWatch({ control, name: "reasoningEffort" });
	const maxTokens = Number(useWatch({ control, name: "maxTokens" }));
	const lowAnswerRoom =
		reasoningEffort !== "none" &&
		maxTokens > MIN_REASONING_BUDGET_TOKENS &&
		maxTokens <= LOW_ANSWER_ROOM_TOKENS;

	const { data: llmModelsData } = useQuery(
		orpc.chat.getModels.queryOptions({ input: { type: "chat" } }),
	);
	const { data: embeddingModelsData } = useQuery(
		orpc.chat.getModels.queryOptions({ input: { type: "embedding" } }),
	);

	// Chat models arrive newest first, with prices per 1M tokens
	const llmModels = llmModelsData?.models ?? [];
	const embeddingModels = embeddingModelsData?.models ?? [];
	const llmModelsById = new Map(llmModels.map((m) => [m.id, m]));
	const embeddingModelsById = new Map(embeddingModels.map((m) => [m.id, m]));

	const fieldError = (name: keyof ProfileFormInput) =>
		errors[name]?.message ? (
			<p className="text-xs text-destructive" role="alert">
				{String(errors[name]?.message)}
			</p>
		) : null;

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
							<Label htmlFor="profile-name">Name *</Label>
							<Input
								id="profile-name"
								{...register("name")}
								placeholder="My Profile"
							/>
							{fieldError("name")}
						</div>
						<div className="col-span-2 space-y-2">
							<Label htmlFor="profile-description">Description</Label>
							<Input
								id="profile-description"
								{...register("description")}
								placeholder="Optional description"
							/>
							{fieldError("description")}
						</div>

						{/* LLM Model */}
						<div className="col-span-2 space-y-2">
							<Label htmlFor="profile-model">LLM Model</Label>
							<Controller
								name="model"
								control={control}
								render={({ field }) => (
									<Combobox
										value={field.value ?? null}
										onValueChange={(v) => field.onChange(v ?? undefined)}
										items={llmModels.map((m) => m.id)}
										filter={(id: string, query: string) =>
											matchesModel(llmModelsById.get(id), id, query)
										}
									>
										<ComboboxInput
											id="profile-model"
											className="w-full"
											placeholder="Search LLM model..."
											showClear
										/>
										<ComboboxContent>
											<ComboboxEmpty>No models found</ComboboxEmpty>
											<ComboboxList>
												{(m: string) => (
													<ModelOption key={m} id={m} model={llmModelsById.get(m)} />
												)}
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								)}
							/>
						</div>

						{/* Embedding Model */}
						<div className="col-span-2 space-y-2">
							<Label htmlFor="profile-embedding">Embedding Model</Label>
							<Controller
								name="embeddingModel"
								control={control}
								render={({ field }) => (
									<Combobox
										value={field.value ?? null}
										onValueChange={(v) => field.onChange(v ?? undefined)}
										items={embeddingModels.map((m) => m.id)}
										filter={(id: string, query: string) =>
											matchesModel(embeddingModelsById.get(id), id, query)
										}
									>
										<ComboboxInput
											id="profile-embedding"
											className="w-full"
											placeholder="Search embedding model..."
											showClear
										/>
										<ComboboxContent>
											<ComboboxEmpty>No models found</ComboboxEmpty>
											<ComboboxList>
												{(m: string) => (
													<ModelOption
														key={m}
														id={m}
														model={embeddingModelsById.get(m)}
													/>
												)}
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								)}
							/>
							{defaultValues && (
								<p className="text-xs text-muted-foreground">
									Changing the embedding model re-indexes this profile's
									documents and uses credits.
								</p>
							)}
						</div>

						<div className="space-y-2">
							<Label htmlFor="profile-chunk-size">Chunk Size (100-4000)</Label>
							<Input
								id="profile-chunk-size"
								{...register("chunkSize")}
								type="number"
								min={100}
								max={4000}
							/>
							{fieldError("chunkSize")}
						</div>
						<div className="space-y-2">
							<Label htmlFor="profile-chunk-overlap">Chunk Overlap</Label>
							<Input
								id="profile-chunk-overlap"
								{...register("chunkOverlap")}
								type="number"
								min={0}
							/>
							{fieldError("chunkOverlap")}
						</div>
						<div className="space-y-2">
							<Label htmlFor="profile-top-k">Top-K Results (1-50)</Label>
							<Input
								id="profile-top-k"
								{...register("topK")}
								type="number"
								min={1}
								max={50}
							/>
							{fieldError("topK")}
						</div>
						<div className="space-y-2">
							<Label htmlFor="profile-temperature">Temperature (0-2)</Label>
							<Input
								id="profile-temperature"
								{...register("temperature")}
								type="number"
								step="0.1"
								min="0"
								max="2"
							/>
							{fieldError("temperature")}
						</div>
						<div className="space-y-2">
							<Label htmlFor="profile-reasoning">Reasoning effort</Label>
							<Controller
								name="reasoningEffort"
								control={control}
								render={({ field }) => (
									<Select
										value={field.value}
										onValueChange={(v) =>
											field.onChange(toReasoningEffort(v ?? undefined))
										}
									>
										<SelectTrigger id="profile-reasoning" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{REASONING_EFFORTS.map((effort) => (
												<SelectItem key={effort} value={effort}>
													{effort}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							/>
							<p className="text-xs text-muted-foreground">
								Thinking uses part of the token limit; on Claude, low reserves
								about 1024 tokens.
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="profile-max-tokens">Max tokens (1-32000)</Label>
							<Input
								id="profile-max-tokens"
								{...register("maxTokens")}
								type="number"
								min={1}
								max={32000}
							/>
							<p className="text-xs text-muted-foreground">
								Limit for one answer, thinking included.
							</p>
							{lowAnswerRoom && (
								<p className="text-xs text-orange-600">
									Little room is left for the answer after thinking, so answers
									may come back empty. Use at least 2048.
								</p>
							)}
							{fieldError("maxTokens")}
						</div>
						<div className="space-y-2">
							<Label htmlFor="profile-score-threshold">
								Score threshold (0-1)
							</Label>
							<Input
								id="profile-score-threshold"
								{...register("scoreThreshold")}
								type="number"
								step="0.05"
								min="0"
								max="1"
							/>
							<p className="text-xs text-muted-foreground">
								Minimum match score for a source. Try 0.15-0.2 when questions
								and documents are in different languages.
							</p>
							{fieldError("scoreThreshold")}
						</div>
						<div className="col-span-2 space-y-2">
							<Label htmlFor="profile-language">Answer language</Label>
							<Input
								id="profile-language"
								{...register("language")}
								placeholder="auto"
							/>
							<p className="text-xs text-muted-foreground">
								&quot;auto&quot; answers in the language of each question. Or
								name one language, e.g. Arabic.
							</p>
							{fieldError("language")}
						</div>
						<div className="col-span-2 space-y-2">
							<Label htmlFor="profile-system-prompt">System Prompt</Label>
							<Textarea
								id="profile-system-prompt"
								{...register("systemPrompt")}
								className="min-h-[80px]"
								placeholder="Optional system prompt..."
							/>
							{fieldError("systemPrompt")}
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
