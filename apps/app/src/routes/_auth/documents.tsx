import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Layout } from "@/components/layout/layout";
import { orpc } from "@/lib/orpc";
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
} from "@tabler/icons-react";

export const Route = createFileRoute("/_auth/documents")({
	component: DocumentsPage,
});

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

	const [isUploadOpen, setIsUploadOpen] = useState(false);
	const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [uploadTitle, setUploadTitle] = useState("");
	const [uploadSource, setUploadSource] = useState("");
	const [uploadProfileId, setUploadProfileId] = useState("none");

	const { data: docs, isLoading } = useQuery(
		orpc.documents.listDocuments.queryOptions({ input: { limit: 50 } }),
	);

	const { data: pendingJobs } = useQuery(
		orpc.documents.getPendingJobs.queryOptions({}),
	);

	const { data: profiles } = useQuery(
		orpc.profiles.listProfiles.queryOptions({ input: { limit: 50 } }),
	);

	const deleteMutation = useMutation(
		orpc.documents.deleteDocument.mutationOptions({
			onSuccess: () => {
				toast.success("Document deleted");
				setDeletingDocId(null);
				queryClient.invalidateQueries({
					queryKey: orpc.documents.listDocuments.key(),
				});
			},
			onError: (err: any) =>
				toast.error(err.message || "Failed to delete document"),
		}),
	);

	const uploadMutation = useMutation(
		orpc.documents.createDocument.mutationOptions({
			onSuccess: () => {
				toast.success("Document uploaded and processing started");
				setIsUploadOpen(false);
				resetUpload();
				queryClient.invalidateQueries({
					queryKey: orpc.documents.listDocuments.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.documents.getPendingJobs.key(),
				});
			},
			onError: (err: any) => toast.error(err.message || "Upload failed"),
		}),
	);

	const resetUpload = () => {
		setSelectedFile(null);
		setUploadTitle("");
		setUploadSource("");
		setUploadProfileId("none");
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

	const docList = (docs as any)?.documents ?? [];
	const jobList = Array.isArray(pendingJobs) ? pendingJobs : [];
	const profileList = (profiles as any)?.profiles ?? [];

	return (
		<Layout>
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
								processing
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{jobList.map((job: any) => (
								<div key={job.jobId} className="flex items-center gap-3">
									<span className="text-xs font-mono text-muted-foreground flex-1 truncate">
										{job.jobId}
									</span>
									<Progress value={job.progress ?? 0} className="w-32 h-1.5" />
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
							{(docs as any)?.total ?? 0} total documents in your knowledge base
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
										docList.map((doc: any) => {
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
							Supported formats: PDF, TXT, MD, DOCX. The document will be
							chunked and indexed automatically.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label>File</Label>
							<div
								className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
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
								<input
									ref={fileInputRef}
									type="file"
									className="hidden"
									accept=".pdf,.txt,.md,.docx"
									onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label>Title (optional)</Label>
							<Input
								placeholder="My Document"
								value={uploadTitle}
								onChange={(e) => setUploadTitle(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label>Source (optional)</Label>
							<Input
								placeholder="e.g. website, manual, internal"
								value={uploadSource}
								onChange={(e) => setUploadSource(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label>Profile (optional)</Label>
							<Select
								value={uploadProfileId}
								onValueChange={(value) => setUploadProfileId(value || "none")}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No profile</SelectItem>
									{profileList.map((p: any) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsUploadOpen(false)}>
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
		</Layout>
	);
}
