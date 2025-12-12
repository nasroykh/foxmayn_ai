import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Send,
	Square,
	Trash2,
	Copy,
	ChevronDown,
	MessageSquare,
	FileText,
	Settings2,
	Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
	listDocuments,
	ragStream,
	type Document,
	type SearchResult,
} from "@/lib/rag";

export const Route = createFileRoute("/_auth/rag/chat")({
	component: ChatPage,
});

function ChatPage() {
	// Query state
	const [query, setQuery] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);

	// Response state
	const [answer, setAnswer] = useState("");
	const [sources, setSources] = useState<SearchResult[]>([]);

	// Filter state
	const [documents, setDocuments] = useState<Document[]>([]);
	const [selectedDocId, setSelectedDocId] = useState<string>("all");
	const [sourceFilter, setSourceFilter] = useState("");
	const [limit, setLimit] = useState(5);
	const [scoreThreshold, setScoreThreshold] = useState(0.7);
	const [filtersOpen, setFiltersOpen] = useState(false);

	// Scroll ref for auto-scroll
	const answerEndRef = useRef<HTMLDivElement>(null);

	// Load documents for filter dropdown
	useEffect(() => {
		const loadDocs = async () => {
			try {
				const result = await listDocuments({ limit: 100 });
				setDocuments(result.documents);
			} catch {
				// Silent fail - filter will just be empty
			}
		};
		loadDocs();
	}, []);

	// Auto-scroll as content streams
	useEffect(() => {
		answerEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [answer]);

	const handleSubmit = async () => {
		if (!query.trim() || isStreaming) return;

		// Reset state
		setAnswer("");
		setSources([]);
		setIsStreaming(true);

		const controller = new AbortController();
		abortControllerRef.current = controller;

		try {
			await ragStream(
				{
					query: query.trim(),
					options: {
						limit,
						scoreThreshold,
						documentId: selectedDocId === "all" ? undefined : selectedDocId,
						source: sourceFilter.trim() || undefined,
					},
				},
				{
					onSources: (newSources) => {
						setSources(newSources);
					},
					onToken: (token) => {
						setAnswer((prev) => prev + token);
					},
					onDone: () => {
						setIsStreaming(false);
					},
					onError: (error) => {
						toast.error(error);
						setIsStreaming(false);
					},
				},
				controller
			);
		} catch (error) {
			if ((error as Error).name !== "AbortError") {
				toast.error(error instanceof Error ? error.message : "Query failed");
			}
			setIsStreaming(false);
		}
	};

	const handleStop = () => {
		abortControllerRef.current?.abort();
		setIsStreaming(false);
	};

	const handleClear = () => {
		setQuery("");
		setAnswer("");
		setSources([]);
	};

	const handleCopyAnswer = () => {
		navigator.clipboard.writeText(answer);
		toast.success("Answer copied to clipboard");
	};

	const handleCopyChunkId = (id: string) => {
		navigator.clipboard.writeText(id);
		toast.success("Chunk ID copied");
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<Layout>
			<div className="space-y-6">
				{/* Header */}
				<div>
					<h1 className="text-2xl font-bold tracking-tight">RAG Chat</h1>
					<p className="text-muted-foreground">
						Query your knowledge base with AI-powered answers
					</p>
				</div>

				{/* Query Card */}
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base">Ask a question</CardTitle>
						<CardDescription>
							Your query will be matched against indexed documents
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Query input */}
						<div className="flex gap-2">
							<Textarea
								placeholder="What would you like to know?"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={handleKeyDown}
								disabled={isStreaming}
								rows={3}
								className="resize-none"
							/>
						</div>

						{/* Filters collapsible */}
						<Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
							<CollapsibleTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="gap-2 text-muted-foreground"
								>
									<Settings2 className="size-4" />
									Filters
									<ChevronDown
										className={`size-4 transition-transform ${
											filtersOpen ? "rotate-180" : ""
										}`}
									/>
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="pt-4">
								<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
									<div className="space-y-2">
										<Label>Document</Label>
										<Select
											value={selectedDocId}
											onValueChange={setSelectedDocId}
										>
											<SelectTrigger>
												<SelectValue placeholder="All documents" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="all">All documents</SelectItem>
												{documents.map((doc) => (
													<SelectItem key={doc.id} value={doc.id}>
														{doc.title}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="space-y-2">
										<Label>Source filter</Label>
										<Input
											placeholder="Filter by source"
											value={sourceFilter}
											onChange={(e) => setSourceFilter(e.target.value)}
										/>
									</div>
									<div className="space-y-2">
										<Label>Max chunks: {limit}</Label>
										<Slider
											value={[limit]}
											onValueChange={(v) => setLimit(v[0])}
											min={1}
											max={20}
											step={1}
										/>
									</div>
									<div className="space-y-2">
										<Label>Min score: {scoreThreshold.toFixed(2)}</Label>
										<Slider
											value={[scoreThreshold]}
											onValueChange={(v) => setScoreThreshold(v[0])}
											min={0}
											max={1}
											step={0.05}
										/>
									</div>
								</div>
							</CollapsibleContent>
						</Collapsible>

						{/* Actions */}
						<div className="flex items-center gap-2">
							{isStreaming ? (
								<Button variant="destructive" onClick={handleStop}>
									<Square className="mr-2 size-4" />
									Stop
								</Button>
							) : (
								<Button onClick={handleSubmit} disabled={!query.trim()}>
									<Send className="mr-2 size-4" />
									Send
								</Button>
							)}
							{(answer || sources.length > 0) && (
								<Button
									variant="outline"
									onClick={handleClear}
									disabled={isStreaming}
								>
									<Trash2 className="mr-2 size-4" />
									Clear
								</Button>
							)}
							<span className="text-xs text-muted-foreground ml-auto">
								⌘+Enter to send
							</span>
						</div>
					</CardContent>
				</Card>

				{/* Response Area */}
				{(answer || sources.length > 0 || isStreaming) && (
					<Card>
						<Tabs defaultValue="answer">
							<CardHeader className="pb-0">
								<div className="flex items-center justify-between">
									<TabsList>
										<TabsTrigger value="answer" className="gap-2">
											<MessageSquare className="size-4" />
											Answer
										</TabsTrigger>
										<TabsTrigger value="sources" className="gap-2">
											<FileText className="size-4" />
											Sources
											{sources.length > 0 && (
												<Badge variant="secondary" className="ml-1">
													{sources.length}
												</Badge>
											)}
										</TabsTrigger>
									</TabsList>
									{answer && !isStreaming && (
										<Button
											variant="ghost"
											size="sm"
											onClick={handleCopyAnswer}
										>
											<Copy className="mr-2 size-4" />
											Copy
										</Button>
									)}
								</div>
							</CardHeader>
							<CardContent className="pt-4">
								<TabsContent value="answer" className="mt-0">
									<ScrollArea className="h-[400px] rounded-md border p-4">
										{answer ? (
											<div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
												{answer}
												{isStreaming && (
													<span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
												)}
											</div>
										) : isStreaming ? (
											<div className="flex items-center gap-2 text-muted-foreground">
												<Loader2 className="size-4 animate-spin" />
												Generating answer...
											</div>
										) : (
											<p className="text-muted-foreground">No answer yet</p>
										)}
										<div ref={answerEndRef} />
									</ScrollArea>
								</TabsContent>
								<TabsContent value="sources" className="mt-0">
									{sources.length === 0 ? (
										<div className="flex flex-col items-center justify-center py-12 text-center">
											<FileText className="size-10 text-muted-foreground mb-3" />
											<p className="text-muted-foreground">No sources found</p>
										</div>
									) : (
										<ScrollArea className="h-[400px]">
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead className="w-[80px]">Score</TableHead>
														<TableHead>Content</TableHead>
														<TableHead className="w-[100px]">Actions</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{sources.map((source, idx) => (
														<TableRow key={source.chunkId}>
															<TableCell>
																<Badge
																	variant={
																		source.score >= 0.8
																			? "default"
																			: "secondary"
																	}
																>
																	{(source.score * 100).toFixed(0)}%
																</Badge>
															</TableCell>
															<TableCell>
																<p className="text-sm line-clamp-3">
																	{source.content}
																</p>
																<p className="text-xs text-muted-foreground mt-1">
																	[{idx + 1}] Doc:{" "}
																	{source.documentId.slice(0, 8)}...
																</p>
															</TableCell>
															<TableCell>
																<Button
																	variant="ghost"
																	size="icon"
																	className="size-8"
																	onClick={() =>
																		handleCopyChunkId(source.chunkId)
																	}
																>
																	<Copy className="size-4" />
																</Button>
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</ScrollArea>
									)}
								</TabsContent>
							</CardContent>
						</Tabs>
					</Card>
				)}
			</div>
		</Layout>
	);
}
