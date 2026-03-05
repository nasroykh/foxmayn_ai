import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Layout } from "@/components/layout/layout";
import { orpc, orpcClient } from "@/lib/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
	IconPlus,
	IconTrash,
	IconSend,
	IconLoader2,
	IconMessage,
	IconRobot,
	IconUser,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_auth/chat")({
	component: ChatPage,
});

type Message = {
	role: "user" | "assistant";
	content: string;
	createdAt?: string;
};

function ChatPage() {
	const queryClient = useQueryClient();
	const messagesEndRef = useRef<HTMLDivElement>(null);

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
	const profiles = (profilesData as any)?.profiles ?? [];
	const models = (modelsData as any)?.models ?? [];

	// Load conversation messages when switching
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

	const handleSend = async () => {
		const query = input.trim();
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

			// Add placeholder for assistant message
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
		<Layout>
			<div className="flex h-full gap-0 overflow-hidden">
				{/* Conversation Sidebar */}
				<div className="w-64 border-r border-border flex flex-col shrink-0">
					<div className="p-3 border-b border-border">
						<Button
							variant="outline"
							className="w-full gap-2"
							onClick={handleNewConversation}
						>
							<IconPlus className="size-4" />
							New Chat
						</Button>
					</div>
					<div className="flex-1 overflow-y-auto p-2 space-y-1">
						{convsLoading ? (
							Array.from({ length: 4 }).map((_, i) => (
								<div key={i} className="p-2 space-y-1">
									<Skeleton className="h-4 w-full" />
									<Skeleton className="h-3 w-24" />
								</div>
							))
						) : conversations.length === 0 ? (
							<div className="p-4 text-center text-muted-foreground text-sm">
								<IconMessage className="size-8 mx-auto mb-2 opacity-30" />
								No conversations yet
							</div>
						) : (
							conversations.map((conv: any) => (
								<div
									key={conv.id}
									className={cn(
										"group flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-muted/60 transition-colors",
										activeConvId === conv.id && "bg-muted",
									)}
									onClick={() => setActiveConvId(conv.id)}
								>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium truncate">
											{conv.title || "Untitled"}
										</p>
										<p className="text-xs text-muted-foreground">
											{conv.createdAt
												? format(new Date(conv.createdAt), "MMM d")
												: ""}
										</p>
									</div>
									<Button
										variant="ghost"
										size="icon"
										className="size-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive shrink-0"
										onClick={(e) => {
											e.stopPropagation();
											setDeletingConvId(conv.id);
										}}
									>
										<IconTrash className="size-3" />
									</Button>
								</div>
							))
						)}
					</div>
				</div>

				{/* Chat Area */}
				<div className="flex-1 flex flex-col overflow-hidden">
					{/* Messages */}
					<div className="flex-1 overflow-y-auto p-4 space-y-4">
						{messages.length === 0 ? (
							<div className="flex flex-col items-center justify-center h-full text-muted-foreground">
								<IconRobot className="size-12 opacity-20 mb-3" />
								<p className="text-sm">Start a conversation</p>
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
												: "bg-muted border border-border",
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
											"max-w-[80%] rounded-xl px-4 py-2.5 text-sm",
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

					{/* Input Area */}
					<div className="border-t border-border p-4 space-y-3 bg-background">
						<div className="flex gap-2">
							<Select
								value={selectedProfileId}
								onValueChange={(value) => setSelectedProfileId(value || "none")}
							>
								<SelectTrigger className="w-44">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
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
									onValueChange={(value) => setSelectedModel(value || "")}
								>
									<SelectTrigger className="w-48">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
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
						<div className="flex gap-2">
							<Input
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="Ask anything..."
								disabled={isStreaming}
								onKeyDown={(e) =>
									e.key === "Enter" && !e.shiftKey && handleSend()
								}
							/>
							<Button
								onClick={handleSend}
								disabled={!input.trim() || isStreaming}
								size="icon"
							>
								{isStreaming ? (
									<IconLoader2 className="size-4 animate-spin" />
								) : (
									<IconSend className="size-4" />
								)}
							</Button>
						</div>
					</div>
				</div>
			</div>

			{/* Delete Confirm */}
			<AlertDialog
				open={!!deletingConvId}
				onOpenChange={() => setDeletingConvId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
						<AlertDialogDescription>
							All messages in this conversation will be permanently deleted.
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
