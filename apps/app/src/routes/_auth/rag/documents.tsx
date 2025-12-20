import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Label } from "@/components/ui/label";
import {
	Plus,
	Upload,
	MoreHorizontal,
	Eye,
	Copy,
	Trash2,
	FileText,
	Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
	createDocument,
	deleteDocument,
	getDocument,
	type Document,
} from "@/lib/rag";
import { useRef } from "react";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_auth/rag/documents")({
	component: DocumentsPage,
});

function getStatusBadgeVariant(status: string) {
	switch (status) {
		case "indexed":
			return "default";
		case "processing":
			return "secondary";
		case "pending":
			return "outline";
		case "failed":
			return "destructive";
		default:
			return "outline";
	}
}

function DocumentsPage() {
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [viewDoc, setViewDoc] = useState<Document | null>(null);
	const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);

	const { data, isLoading } = useQuery(
		orpc.documents.listDocuments.queryOptions({
			input: {},
		})
	);

	const documents = data?.documents ?? [];

	const deleteMutation = useMutation({
		mutationFn: deleteDocument,
		onSuccess: () => {
			toast.success("Document deleted");
			setDeleteDoc(null);
			queryClient.invalidateQueries({ queryKey: ["documents"] });
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete document"
			);
		},
	});

	const handleDelete = () => {
		if (!deleteDoc) return;
		deleteMutation.mutate(deleteDoc.id);
	};

	const handleCopyId = (id: string) => {
		navigator.clipboard.writeText(id);
		toast.success("ID copied to clipboard");
	};

	const handleView = async (doc: Document) => {
		try {
			// Pre-fetch specific document details on view click
			const fullDoc = await getDocument(doc.id);
			setViewDoc(fullDoc);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load document"
			);
		}
	};

	return (
		<Layout>
			<div className="space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">Documents</h1>
						<p className="text-muted-foreground">
							Manage your RAG knowledge base documents
						</p>
					</div>
					<div className="flex gap-2">
						<Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
							<DialogTrigger asChild>
								<Button variant="outline">
									<Upload className="mr-2 size-4" />
									Upload
								</Button>
							</DialogTrigger>
							<UploadDialog onSuccess={() => setUploadOpen(false)} />
						</Dialog>
						<Dialog open={createOpen} onOpenChange={setCreateOpen}>
							<DialogTrigger asChild>
								<Button>
									<Plus className="mr-2 size-4" />
									New Document
								</Button>
							</DialogTrigger>
							<CreateDialog onSuccess={() => setCreateOpen(false)} />
						</Dialog>
					</div>
				</div>

				{/* Documents Table */}
				<Card>
					<CardHeader>
						<CardTitle>All Documents</CardTitle>
						<CardDescription>
							{documents.length} document{documents.length !== 1 ? "s" : ""} in
							your knowledge base
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="space-y-3">
								{[1, 2, 3].map((i) => (
									<div key={i} className="flex items-center gap-4">
										<Skeleton className="size-10 rounded" />
										<div className="flex-1 space-y-2">
											<Skeleton className="h-4 w-48" />
											<Skeleton className="h-3 w-32" />
										</div>
										<Skeleton className="h-6 w-16" />
									</div>
								))}
							</div>
						) : documents.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-12 text-center">
								<FileText className="size-12 text-muted-foreground mb-4" />
								<h3 className="text-lg font-semibold mb-2">No documents yet</h3>
								<p className="text-muted-foreground text-sm mb-4">
									Create or upload your first document to get started
								</p>
								<Button onClick={() => setCreateOpen(true)}>
									<Plus className="mr-2 size-4" />
									New Document
								</Button>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Title</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Chunks</TableHead>
										<TableHead>Source</TableHead>
										<TableHead>Updated</TableHead>
										<TableHead className="w-12.5" />
									</TableRow>
								</TableHeader>
								<TableBody>
									{documents.map((doc) => (
										<TableRow key={doc.id}>
											<TableCell className="font-medium">{doc.title}</TableCell>
											<TableCell>
												<Badge variant={getStatusBadgeVariant(doc.status)}>
													{doc.status}
												</Badge>
											</TableCell>
											<TableCell>{doc.chunkCount ?? "-"}</TableCell>
											<TableCell className="max-w-50 truncate">
												{doc.source || "-"}
											</TableCell>
											<TableCell>
												{new Date(doc.updatedAt).toLocaleDateString()}
											</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
														>
															<MoreHorizontal className="size-4" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem onClick={() => handleView(doc)}>
															<Eye className="mr-2 size-4" />
															View
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => handleCopyId(doc.id)}
														>
															<Copy className="mr-2 size-4" />
															Copy ID
														</DropdownMenuItem>
														<DropdownMenuItem
															className="text-destructive focus:text-destructive"
															onClick={() => setDeleteDoc(doc)}
														>
															<Trash2 className="mr-2 size-4" />
															Delete
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				{/* View Dialog */}
				<Dialog
					open={!!viewDoc}
					onOpenChange={(open) => !open && setViewDoc(null)}
				>
					<DialogContent className="max-w-2xl">
						<DialogHeader>
							<DialogTitle>{viewDoc?.title}</DialogTitle>
							<DialogDescription>
								ID: {viewDoc?.id} • Status: {viewDoc?.status} •{" "}
								{viewDoc?.chunkCount ?? 0} chunks
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							{viewDoc?.source && (
								<div>
									<Label className="text-muted-foreground">Source</Label>
									<p className="text-sm mt-1">{viewDoc.source}</p>
								</div>
							)}
							{viewDoc?.metadata &&
								Object.keys(viewDoc.metadata).length > 0 && (
									<div>
										<Label className="text-muted-foreground">Metadata</Label>
										<pre className="text-sm mt-1 bg-muted p-2 rounded overflow-auto max-h-24">
											{JSON.stringify(viewDoc.metadata, null, 2)}
										</pre>
									</div>
								)}
							<div>
								<Label className="text-muted-foreground">Timestamps</Label>
								<p className="text-sm mt-1">
									Created:{" "}
									{viewDoc ? new Date(viewDoc.createdAt).toLocaleString() : "-"}
									<br />
									Updated:{" "}
									{viewDoc ? new Date(viewDoc.updatedAt).toLocaleString() : "-"}
								</p>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => viewDoc && handleCopyId(viewDoc.id)}
							>
								<Copy className="mr-2 size-4" />
								Copy ID
							</Button>
							<Button onClick={() => setViewDoc(null)}>Close</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				{/* Delete Confirmation */}
				<AlertDialog
					open={!!deleteDoc}
					onOpenChange={(open) => !open && setDeleteDoc(null)}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete Document</AlertDialogTitle>
							<AlertDialogDescription>
								Are you sure you want to delete "{deleteDoc?.title}"? This will
								also remove all associated chunks and vectors. This action
								cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleDelete}
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
								disabled={deleteMutation.isPending}
							>
								{deleteMutation.isPending ? "Deleting..." : "Delete"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</Layout>
	);
}

// Create Document Dialog
function CreateDialog({ onSuccess }: { onSuccess: () => void }) {
	const queryClient = useQueryClient();
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [source, setSource] = useState("");
	const [metadata, setMetadata] = useState("");

	const createMutation = useMutation({
		mutationFn: createDocument,
		onSuccess: () => {
			toast.success("Document created and indexing started");
			setTitle("");
			setContent("");
			setSource("");
			setMetadata("");
			queryClient.invalidateQueries({ queryKey: ["documents"] });
			onSuccess();
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to create document"
			);
		},
	});

	const handleSubmit = () => {
		if (!title.trim() || !content.trim()) {
			toast.error("Title and content are required");
			return;
		}

		let parsedMetadata: Record<string, unknown> | undefined;
		if (metadata.trim()) {
			try {
				parsedMetadata = JSON.parse(metadata);
			} catch {
				toast.error("Invalid JSON in metadata field");
				return;
			}
		}

		createMutation.mutate({
			title: title.trim(),
			content: content.trim(),
			source: source.trim() || undefined,
			metadata: parsedMetadata,
		});
	};

	return (
		<DialogContent className="max-w-lg">
			<DialogHeader>
				<DialogTitle>Create Document</DialogTitle>
				<DialogDescription>
					Add a new document to your RAG knowledge base
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 py-2">
				<div className="space-y-2">
					<Label htmlFor="title">Title *</Label>
					<Input
						id="title"
						placeholder="Document title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						disabled={createMutation.isPending}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="content">Content *</Label>
					<Textarea
						id="content"
						placeholder="Paste your document content here..."
						rows={8}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						disabled={createMutation.isPending}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="source">Source (optional)</Label>
					<Input
						id="source"
						placeholder="https://example.com/doc or internal-ref"
						value={source}
						onChange={(e) => setSource(e.target.value)}
						disabled={createMutation.isPending}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="metadata">Metadata JSON (optional)</Label>
					<Textarea
						id="metadata"
						placeholder='{"author": "John", "category": "tech"}'
						rows={2}
						value={metadata}
						onChange={(e) => setMetadata(e.target.value)}
						disabled={createMutation.isPending}
					/>
				</div>
			</div>
			<DialogFooter>
				<Button onClick={handleSubmit} disabled={createMutation.isPending}>
					{createMutation.isPending ? (
						<>
							<Loader2 className="mr-2 size-4 animate-spin" />
							Creating...
						</>
					) : (
						"Create Document"
					)}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

// Upload Document Dialog
function UploadDialog({ onSuccess }: { onSuccess: () => void }) {
	const queryClient = useQueryClient();
	const [file, setFile] = useState<File | null>(null);
	const [title, setTitle] = useState("");
	const [source, setSource] = useState("");
	const [metadata, setMetadata] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const uploadMutation = useMutation(
		orpc.documents.uploadDocument.mutationOptions({
			onSuccess: () => {
				toast.success("File uploaded and indexing started");
				setFile(null);
				setTitle("");
				setSource("");
				setMetadata("");
				if (fileInputRef.current) fileInputRef.current.value = "";
				queryClient.invalidateQueries({ queryKey: ["documents"] });
				onSuccess();
			},
			onError: (error) => {
				toast.error(
					error instanceof Error ? error.message : "Failed to upload file"
				);
			},
		})
	);

	const handleSubmit = () => {
		if (!file) {
			toast.error("Please select a file");
			return;
		}

		let parsedMetadata: Record<string, unknown> | undefined;
		if (metadata.trim()) {
			try {
				parsedMetadata = JSON.parse(metadata);
			} catch {
				toast.error("Invalid JSON in metadata field");
				return;
			}
		}

		uploadMutation.mutate({
			file,
			title: title.trim() || undefined,
			source: source.trim() || undefined,
			metadata,
		});
	};

	return (
		<DialogContent className="max-w-lg">
			<DialogHeader>
				<DialogTitle>Upload File</DialogTitle>
				<DialogDescription>
					Upload a text file (.txt, .md, .csv, .json, .xml, .html)
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 py-2">
				<div className="space-y-2">
					<Label htmlFor="file">File *</Label>
					<Input
						ref={fileInputRef}
						id="file"
						type="file"
						accept=".txt,.md,.csv,.json,.xml,.html"
						onChange={(e) => setFile(e.target.files?.[0] || null)}
						disabled={uploadMutation.isPending}
					/>
					{file && (
						<p className="text-sm text-muted-foreground">
							Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
						</p>
					)}
				</div>
				<div className="space-y-2">
					<Label htmlFor="upload-title">
						Title (optional, defaults to filename)
					</Label>
					<Input
						id="upload-title"
						placeholder="Document title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						disabled={uploadMutation.isPending}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="upload-source">Source (optional)</Label>
					<Input
						id="upload-source"
						placeholder="https://example.com/doc"
						value={source}
						onChange={(e) => setSource(e.target.value)}
						disabled={uploadMutation.isPending}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="upload-metadata">Metadata JSON (optional)</Label>
					<Textarea
						id="upload-metadata"
						placeholder='{"author": "John"}'
						rows={2}
						value={metadata}
						onChange={(e) => setMetadata(e.target.value)}
						disabled={uploadMutation.isPending}
					/>
				</div>
			</div>
			<DialogFooter>
				<Button
					onClick={handleSubmit}
					disabled={uploadMutation.isPending || !file}
				>
					{uploadMutation.isPending ? (
						<>
							<Loader2 className="mr-2 size-4 animate-spin" />
							Uploading...
						</>
					) : (
						<>
							<Upload className="mr-2 size-4" />
							Upload
						</>
					)}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}
