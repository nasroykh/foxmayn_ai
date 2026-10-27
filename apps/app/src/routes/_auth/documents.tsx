import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { orpc, type RouterOutputs } from "@/lib/orpc";
import { errorMessage } from "@/lib/validation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
	IconUpload,
	IconTrash,
	IconLoader2,
	IconFile,
	IconAlertCircle,
	IconChevronLeft,
	IconChevronRight,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_auth/documents")({
	staticData: { title: "Documents" },
	component: DocumentsPage,
});

const PAGE_SIZE = 20;
const POLL_MS = 3000;
// Mirrors the API (apps/api/src/utils/file_validation.ts)
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
	pdf: "application/pdf",
	txt: "text/plain",
	md: "text/markdown",
	html: "text/html",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const ACCEPT = Object.keys(MIME_BY_EXTENSION)
	.map((e) => `.${e}`)
	.join(",");

type DocumentRow = RouterOutputs["documents"]["listDocuments"]["documents"][number];

const isActiveStatus = (status: string) =>
	status === "pending" || status === "processing";

/** Returns a File the API will accept, or an error message. */
function prepareUpload(file: File): { file: File } | { error: string } {
	if (file.size === 0) return { error: "The file is empty" };
	if (file.size > MAX_FILE_SIZE) {
		return { error: "The file is larger than the 10 MB limit" };
	}
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	const mime = MIME_BY_EXTENSION[ext];
	if (!mime) {
		return { error: "Unsupported file type. Use PDF, TXT, MD, HTML or DOCX" };
	}
	// Browsers often send an empty or generic type for .md
	return file.type === mime
		? { file }
		: { file: new File([file], file.name, { type: mime }) };
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
	indexed: {
		label: "Indexed",
		className: "text-emerald-600 border-emerald-200 bg-emerald-50",
	},
	processing: {
		label: "Processing",
		className: "text-blue-600 border-blue-200 bg-blue-50",
	},
	pending: {
		label: "Pending",
		className: "text-orange-600 border-orange-200 bg-orange-50",
	},
	failed: {
		label: "Failed",
		className: "text-destructive border-destructive/20 bg-destructive/5",
	},
};

function DocumentsPage() {
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [offset, setOffset] = useState(0);
	const [isUploadOpen, setIsUploadOpen] = useState(false);
	const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [uploadTitle, setUploadTitle] = useState("");
	const [uploadSource, setUploadSource] = useState("");
	const [uploadProfileId, setUploadProfileId] = useState("none");
	// Remounting the input is how a file input is cleared
	const [fileInputKey, setFileInputKey] = useState(0);

	// Poll while any document on the page is still being indexed
	const { data: docs, isLoading } = useQuery({
		...orpc.documents.listDocuments.queryOptions({
			input: { limit: PAGE_SIZE, offset },
		}),
		placeholderData: (previous) => previous,
		refetchInterval: (query) =>
			query.state.data?.documents.some((d) => isActiveStatus(d.status))
				? POLL_MS
				: false,
	});

	const hasActiveDocs =
		docs?.documents.some((d) => isActiveStatus(d.status)) ?? false;

	const { data: pendingJobs } = useQuery({
		...orpc.documents.getPendingJobs.queryOptions({ input: {} }),
		refetchInterval: (query) =>
			hasActiveDocs || (query.state.data?.jobs.length ?? 0) > 0
				? POLL_MS
				: false,
	});

	const { data: profiles } = useQuery(
		orpc.profiles.listProfiles.queryOptions({ input: { limit: 50 } }),
	);

	// Indexing spends credits: refresh balance and usage once it finishes
	const wasActive = useRef(false);
	useEffect(() => {
		if (wasActive.current && !hasActiveDocs) {
			void queryClient.invalidateQueries({ queryKey: orpc.credits.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.usage.key() });
		}
		wasActive.current = hasActiveDocs;
	}, [hasActiveDocs, queryClient]);

	const deleteMutation = useMutation(
		orpc.documents.deleteDocument.mutationOptions({
			onSuccess: () => {
				toast.success("Document deleted");
				setDeletingDocId(null);
				// Removed the only row of this page: step back instead of showing it empty
				if (offset > 0 && docList.length <= 1) {
					setOffset(Math.max(0, offset - PAGE_SIZE));
				}
				void queryClient.invalidateQueries({
					queryKey: orpc.documents.listDocuments.key(),
				});
			},
			onError: (err) =>
				toast.error(errorMessage(err, "Failed to delete document")),
		}),
	);

	const uploadMutation = useMutation(
		orpc.documents.createDocument.mutationOptions({
			onSuccess: () => {
				toast.success("Document uploaded and processing started");
				setIsUploadOpen(false);
				resetUpload();
				setOffset(0);
				void queryClient.invalidateQueries({
					queryKey: orpc.documents.listDocuments.key(),
				});
				void queryClient.invalidateQueries({
					queryKey: orpc.documents.getPendingJobs.key(),
				});
				void queryClient.invalidateQueries({ queryKey: orpc.credits.key() });
				void queryClient.invalidateQueries({ queryKey: orpc.usage.key() });
			},
			onError: (err) => toast.error(errorMessage(err, "Upload failed")),
		}),
	);

	function resetUpload() {
		setSelectedFile(null);
		setUploadTitle("");
		setUploadSource("");
		setUploadProfileId("none");
		setFileInputKey((k) => k + 1);
	}

	const handleSelectFile = (file: File | null) => {
		if (!file) {
			setSelectedFile(null);
			return;
		}
		const prepared = prepareUpload(file);
		if ("error" in prepared) {
			toast.error(prepared.error);
			setSelectedFile(null);
			setFileInputKey((k) => k + 1);
			return;
		}
		setSelectedFile(prepared.file);
	};

	const handleUpload = () => {
		if (!selectedFile) return;
		uploadMutation.mutate({
			file: selectedFile,
			title: uploadTitle || undefined,
			source: uploadSource || undefined,
			profileId: uploadProfileId !== "none" ? uploadProfileId : undefined,
		});
	};

	const docList: DocumentRow[] = docs?.documents ?? [];
	const total = docs?.total ?? 0;
	const jobList = pendingJobs?.jobs ?? [];
	const profileList = profiles?.profiles ?? [];
	const titleByDocId = new Map(docList.map((d) => [d.id, d.title]));
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const page = Math.floor(offset / PAGE_SIZE) + 1;

	return (
		<>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold">Documents</h1>
						<p className="text-muted-foreground text-sm">
							Upload and manage your knowledge base
						</p>
					</div>
					<Button onClick={() => setIsUploadOpen(true)} className="gap-2">
						<IconUpload className="size-4" />
						Upload
					</Button>
				</div>

				{/* Pending Jobs Banner */}
				{jobList.length > 0 && (
					<Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm flex items-center gap-2">
								<IconLoader2 className="size-4 animate-spin text-blue-600" />
								{jobList.length} document{jobList.length > 1 ? "s" : ""}{" "}
								processing{pendingJobs?.hasMore ? " (more not shown)" : ""}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{jobList.map((job) => (
								<div key={job.jobId} className="flex items-center gap-3">
									<span className="text-xs font-mono text-muted-foreground flex-1 truncate">
										{titleByDocId.get(job.documentId) ?? "Document"}
									</span>
									<Progress value={job.progress} className="w-32 h-1.5" />
									<span className="text-xs text-muted-foreground">
										{job.state}
									</span>
								</div>
							))}
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Documents</CardTitle>
						<CardDescription>
							{total} total documents in your knowledge base
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="rounded-md border border-input overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Title</TableHead>
										<TableHead>Source</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Chunks</TableHead>
										<TableHead>Created</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{isLoading ? (
										Array.from({ length: 4 }).map((_, i) => (
											<TableRow key={i}>
												{Array.from({ length: 6 }).map((_, j) => (
													<TableCell key={j}>
														<Skeleton className="h-4 w-full" />
													</TableCell>
												))}
											</TableRow>
										))
									) : docList.length === 0 ? (
										<TableRow>
											<TableCell colSpan={6} className="h-24 text-center">
												<div className="flex flex-col items-center gap-2 text-muted-foreground">
													<IconFile className="size-8 opacity-40" />
													<span>
														No documents yet. Upload one to get started.
													</span>
												</div>
											</TableCell>
										</TableRow>
									) : (
										docList.map((doc) => {
											const statusInfo = STATUS_BADGES[doc.status] ?? {
												label: doc.status,
												className: "",
											};
											return (
												<TableRow key={doc.id}>
													<TableCell className="font-medium max-w-[200px] truncate">
														{doc.title}
													</TableCell>
													<TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">
														{doc.source || "—"}
													</TableCell>
													<TableCell>
														<Badge
															variant="outline"
															className={statusInfo.className}
														>
															{doc.status === "failed" && (
																<IconAlertCircle className="size-3 mr-1" />
															)}
															{statusInfo.label}
														</Badge>
													</TableCell>
													<TableCell className="text-muted-foreground">
														{doc.chunkCount ?? 0}
													</TableCell>
													<TableCell className="text-sm text-muted-foreground">
														{doc.createdAt
															? format(new Date(doc.createdAt), "MMM d, yyyy")
															: "—"}
													</TableCell>
													<TableCell className="text-right">
														<Button
															variant="ghost"
															size="icon"
															className="size-8 text-destructive hover:text-destructive"
															aria-label={`Delete ${doc.title}`}
															onClick={() => setDeletingDocId(doc.id)}
														>
															<IconTrash className="size-4" />
														</Button>
													</TableCell>
												</TableRow>
											);
										})
									)}
								</TableBody>
							</Table>
						</div>
						{total > PAGE_SIZE && (
							<div className="flex items-center justify-between pt-4">
								<span className="text-sm text-muted-foreground">
									Page {page} of {pageCount}
								</span>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="icon"
										aria-label="Previous page"
										disabled={offset === 0}
										onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
									>
										<IconChevronLeft className="size-4" />
									</Button>
									<Button
										variant="outline"
										size="icon"
										aria-label="Next page"
										disabled={offset + PAGE_SIZE >= total}
										onClick={() => setOffset(offset + PAGE_SIZE)}
									>
										<IconChevronRight className="size-4" />
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Upload Dialog */}
			<Dialog
				open={isUploadOpen}
				onOpenChange={(v) => {
					setIsUploadOpen(v);
					if (!v) resetUpload();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Upload Document</DialogTitle>
						<DialogDescription>
							Supported formats: PDF, TXT, MD, HTML, DOCX (up to 10 MB). The
							document will be chunked and indexed automatically.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="upload-file">File</Label>
							<button
								type="button"
								className="w-full border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:border-primary/50 focus-visible:border-primary transition-colors outline-none"
								onClick={() => fileInputRef.current?.click()}
							>
								{selectedFile ? (
									<div className="flex items-center justify-center gap-2">
										<IconFile className="size-5 text-primary" />
										<span className="font-medium">{selectedFile.name}</span>
										<span className="text-muted-foreground text-xs">
											({(selectedFile.size / 1024).toFixed(1)} KB)
										</span>
									</div>
								) : (
									<div className="flex flex-col items-center gap-1 text-muted-foreground">
										<IconUpload className="size-8 opacity-40" />
										<span className="text-sm">Click to select a file</span>
									</div>
								)}
							</button>
							<input
								key={fileInputKey}
								id="upload-file"
								ref={fileInputRef}
								type="file"
								className="sr-only"
								tabIndex={-1}
								accept={ACCEPT}
								onChange={(e) => handleSelectFile(e.target.files?.[0] ?? null)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="upload-title">Title (optional)</Label>
							<Input
								id="upload-title"
								placeholder="My Document"
								value={uploadTitle}
								onChange={(e) => setUploadTitle(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="upload-source">Source (optional)</Label>
							<Input
								id="upload-source"
								placeholder="e.g. website, manual, internal"
								value={uploadSource}
								onChange={(e) => setUploadSource(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="upload-profile">Profile (optional)</Label>
							<Select
								value={uploadProfileId}
								onValueChange={(value) => setUploadProfileId(value || "none")}
							>
								<SelectTrigger id="upload-profile">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No profile</SelectItem>
									{profileList.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setIsUploadOpen(false);
								resetUpload();
							}}
						>
							Cancel
						</Button>
						<Button
							disabled={!selectedFile || uploadMutation.isPending}
							onClick={handleUpload}
						>
							{uploadMutation.isPending && (
								<IconLoader2 className="mr-2 size-4 animate-spin" />
							)}
							Upload
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirm */}
			<AlertDialog
				open={!!deletingDocId}
				onOpenChange={() => setDeletingDocId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this document?</AlertDialogTitle>
						<AlertDialogDescription>
							All chunks and vector data will be permanently removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
							onClick={() =>
								deletingDocId && deleteMutation.mutate({ id: deletingDocId })
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
