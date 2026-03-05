import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Layout } from "@/components/layout/layout";
import { orpc, orpcClient } from "@/lib/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, isToday, isYesterday, subDays, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import {
	IconPlus,
	IconTrash,
	IconMessage,
	IconRobot,
	IconUser,
	IconDots,
	IconArrowUp,
	IconPlayerStopFilled,
} from "@tabler/icons-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_auth/chat")({
	component: ChatPage,
});

type Message = {
	role: "user" | "assistant";
	content: string;
	createdAt?: string;
};

function groupConversations(conversations: any[]) {
	const today: any[] = [];
	const yesterday: any[] = [];
	const lastWeek: any[] = [];
	const older: any[] = [];
	const now = startOfDay(new Date());
	const weekAgo = startOfDay(subDays(now, 7));

	for (const conv of conversations) {
		const d = conv.createdAt ? startOfDay(new Date(conv.createdAt)) : now;
		if (isToday(d)) today.push(conv);
		else if (isYesterday(d)) yesterday.push(conv);
		else if (d >= weekAgo) lastWeek.push(conv);
		else older.push(conv);
	}

	return [
		{ label: "Today", items: today },
		{ label: "Yesterday", items: yesterday },
		{ label: "Last 7 days", items: lastWeek },
		{ label: "Older", items: older },
	].filter((g) => g.items.length > 0);
}

function ChatPage() {
	const queryClient = useQueryClient();
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [selectedProfileId, setSelectedProfileId] = useState<string>("none");
	const [selectedModel, setSelectedModel] = useState<string>("");
	const [deletingConvId, setDeletingConvId] = useState<string | null>(null);

	const { data: convData, isLoading: convsLoading } = useQuery(
		orpc.conversations.listConversations.queryOptions({ input: { limit: 50 } }),
	);
	const { data: profilesData } = useQuery(
		orpc.profiles.listProfiles.queryOptions({ input: { limit: 50 } }),
	);
	const { data: modelsData } = useQuery(
		orpc.chat.getModels.queryOptions({ input: {} }),
	);

	const deleteConvMutation = useMutation(
		orpc.conversations.deleteConversation.mutationOptions({
			onSuccess: () => {
				toast.success("Conversation deleted");
				setDeletingConvId(null);
				if (activeConvId === deletingConvId) {
					setActiveConvId(null);
					setMessages([]);
				}
				queryClient.invalidateQueries({
					queryKey: orpc.conversations.listConversations.key(),
				});
			},
			onError: (err: any) => toast.error(err.message),
		}),
	);

	const conversations = (convData as any)?.conversations ?? [];
	const groups = groupConversations(conversations);
	const profiles = (profilesData as any)?.profiles ?? [];
	const models = (modelsData as any)?.models ?? [];

	const { data: convWithMessages } = useQuery({
		...orpc.conversations.getConversationWithMessages.queryOptions({
			input: { id: activeConvId! },
		}),
		enabled: !!activeConvId,
	});

	useEffect(() => {
		if (convWithMessages && (convWithMessages as any)?.messages) {
			setMessages(
				((convWithMessages as any).messages as any[]).map((m) => ({
					role: m.role as "user" | "assistant",
					content: m.content,
					createdAt: m.createdAt,
				})),
			);
		}
	}, [convWithMessages]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleNewConversation = () => {
		setActiveConvId(null);
		setMessages([]);
	};

	const handleSend = async (forcedQuery?: string) => {
		const query = (forcedQuery || input).trim();
		if (!query || isStreaming) return;

		setInput("");
		setIsStreaming(true);

		const userMessage: Message = { role: "user", content: query };
		setMessages((prev) => [...prev, userMessage]);

		let assistantContent = "";
		let newConvId: string | null = activeConvId;

		try {
			const stream = await orpcClient.chat.queryStream({
				query,
				conversationId: activeConvId ?? undefined,
				options: {
					profileId:
						selectedProfileId !== "none" ? selectedProfileId : undefined,
				},
			});

			setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

			for await (const chunk of stream) {
				if (chunk.type === "conversation_id") {
					newConvId = chunk.data;
					if (!activeConvId) {
						setActiveConvId(chunk.data);
						queryClient.invalidateQueries({
							queryKey: orpc.conversations.listConversations.key(),
						});
					}
				} else if (chunk.type === "token") {
					assistantContent += chunk.data;
					setMessages((prev) => {
						const updated = [...prev];
						updated[updated.length - 1] = {
							role: "assistant",
							content: assistantContent,
						};
						return updated;
					});
				}
			}

			if (newConvId) {
				queryClient.invalidateQueries({
					queryKey: orpc.conversations.listConversations.key(),
				});
			}
		} catch (err: any) {
			toast.error(err.message || "Chat failed");
			setMessages((prev) => prev.filter((m) => m !== userMessage));
		} finally {
			setIsStreaming(false);
		}
	};

	return (
		<Layout hideHeader>
			<div className="flex h-[calc(100vh-1rem)] overflow-hidden -m-4">
				{/* Sidebar */}
				<div className="w-64 border-r flex-col shrink-0 hidden lg:flex">
					<div className="h-14 px-4 border-b flex items-center justify-between">
						<span className="font-semibold text-sm">Chats</span>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							onClick={handleNewConversation}
						>
							<IconPlus className="size-4" />
						</Button>
					</div>

					<ScrollArea className="flex-1">
						<div className="p-2 space-y-4">
							{convsLoading ? (
								Array.from({ length: 4 }).map((_, i) => (
									<div key={i} className="p-2 space-y-1.5">
										<Skeleton className="h-4 w-full" />
										<Skeleton className="h-3 w-20" />
									</div>
								))
							) : groups.length === 0 ? (
								<div className="py-16 text-center text-muted-foreground">
									<IconMessage className="size-8 mx-auto mb-2 opacity-20" />
									<p className="text-sm">No conversations yet</p>
								</div>
							) : (
								groups.map((group) => (
									<div key={group.label} className="space-y-0.5">
										<p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
											{group.label}
										</p>
										{group.items.map((conv: any) => (
											<div
												key={conv.id}
												className={cn(
													"group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors hover:bg-muted/60",
													activeConvId === conv.id && "bg-muted",
												)}
												onClick={() => setActiveConvId(conv.id)}
											>
												<div className="flex-1 min-w-0">
													<p className="text-sm truncate">
														{conv.title || "Untitled"}
													</p>
													<p className="text-[11px] text-muted-foreground">
														{conv.createdAt
															? format(new Date(conv.createdAt), "h:mm a")
															: ""}
													</p>
												</div>
												<DropdownMenu>
													<DropdownMenuTrigger
														render={
															<Button
																variant="ghost"
																size="icon"
																className="size-6 opacity-0 group-hover:opacity-100 shrink-0"
																onClick={(e) => e.stopPropagation()}
															/>
														}
													>
														<IconDots className="size-3" />
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															variant="destructive"
															onClick={() => setDeletingConvId(conv.id)}
														>
															<IconTrash className="size-4 mr-2" />
															Delete
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</div>
										))}
									</div>
								))
							)}
						</div>
					</ScrollArea>
				</div>

				{/* Chat area */}
				<div className="flex-1 flex flex-col min-w-0">
					{/* Header */}
					<header className="h-14 border-b px-4 flex items-center justify-between gap-4">
						<div className="flex items-center gap-2 min-w-0">
							<SidebarTrigger className="lg:hidden" />
							<h1 className="text-sm font-semibold truncate">
								{activeConvId
									? conversations.find((c: any) => c.id === activeConvId)
											?.title || "Chat"
									: "New Chat"}
							</h1>
						</div>

						<div className="flex items-center gap-2 shrink-0">
							<Select
								value={selectedProfileId}
								onValueChange={(v) => setSelectedProfileId(v || "none")}
							>
								<SelectTrigger className="h-8 text-xs hidden md:flex">
									<SelectValue />
								</SelectTrigger>
								<SelectContent align="end">
									<SelectItem value="none">No profile</SelectItem>
									{profiles.map((p: any) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							{models.length > 0 && (
								<Select
									value={selectedModel}
									onValueChange={(v) => setSelectedModel(v || "")}
								>
									<SelectTrigger className="h-8 text-xs hidden md:flex">
										<SelectValue />
									</SelectTrigger>
									<SelectContent align="end">
										<SelectItem value="">Default model</SelectItem>
										{models.map((m: any) => (
											<SelectItem key={m.id} value={m.id}>
												{m.id}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>
					</header>

					{/* Messages */}
					<ScrollArea className="flex-1">
						<div className="max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
							{messages.length === 0 ? (
								<div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6">
									<div className="size-12 rounded-xl bg-muted flex items-center justify-center">
										<IconRobot className="size-6 text-muted-foreground" />
									</div>
									<div className="space-y-1">
										<h2 className="text-lg font-semibold">
											How can I help you?
										</h2>
										<p className="text-sm text-muted-foreground max-w-sm">
											Ask me anything or pick a suggestion below.
										</p>
									</div>

									<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
										{[
											"Plan a trip to Tokyo for 5 days",
											"Explain quantum entanglement simply",
											"Review this React component",
											"Summarize recent AI trends",
										].map((prompt) => (
											<button
												key={prompt}
												className="text-left text-sm p-3 rounded-lg border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
												onClick={() => handleSend(prompt)}
											>
												{prompt}
											</button>
										))}
									</div>
								</div>
							) : (
								messages.map((msg, i) => (
									<div
										key={i}
										className={cn(
											"flex gap-3",
											msg.role === "user" && "flex-row-reverse",
										)}
									>
										<div
											className={cn(
												"flex items-center justify-center size-7 rounded-full shrink-0 mt-0.5",
												msg.role === "user"
													? "bg-primary text-primary-foreground"
													: "bg-muted border",
											)}
										>
											{msg.role === "user" ? (
												<IconUser className="size-4" />
											) : (
												<IconRobot className="size-4" />
											)}
										</div>
										<div
											className={cn(
												"max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
												msg.role === "user"
													? "bg-primary text-primary-foreground"
													: "bg-muted",
											)}
										>
											{msg.content ||
												(isStreaming && i === messages.length - 1 ? (
													<span className="inline-block w-2 h-4 bg-current animate-pulse rounded" />
												) : null)}
										</div>
									</div>
								))
							)}
							<div ref={messagesEndRef} />
						</div>
					</ScrollArea>

					{/* Input */}
					<div className="border-t p-4">
						<div className="max-w-2xl mx-auto flex gap-2 items-end">
							<Textarea
								ref={textareaRef}
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="Message..."
								className="flex-1 min-h-10 max-h-40 resize-none"
								disabled={isStreaming}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleSend();
									}
								}}
							/>
							<Button
								onClick={() => (isStreaming ? undefined : handleSend())}
								disabled={!input.trim() && !isStreaming}
								size="icon"
								variant={isStreaming ? "secondary" : "default"}
							>
								{isStreaming ? (
									<IconPlayerStopFilled className="size-4" />
								) : (
									<IconArrowUp className="size-4" />
								)}
							</Button>
						</div>
					</div>
				</div>
			</div>

			{/* Delete dialog */}
			<AlertDialog
				open={!!deletingConvId}
				onOpenChange={() => setDeletingConvId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
						<AlertDialogDescription>
							All messages will be permanently deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteConvMutation.isPending}
							onClick={() =>
								deletingConvId &&
								deleteConvMutation.mutate({ id: deletingConvId })
							}
						>
							{deleteConvMutation.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Layout>
	);
}
