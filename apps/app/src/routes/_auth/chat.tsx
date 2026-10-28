import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { orpc, orpcClient, type RouterOutputs } from "@/lib/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
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
import { Markdown } from "@/components/markdown";
import { errorMessage } from "@/lib/validation";
import { authClient } from "@/lib/auth";
import {
	IconPlus,
	IconTrash,
	IconSend,
	IconLoader2,
	IconMessage,
	IconRobot,
	IconUser,
	IconPlayerStop,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_auth/chat")({
	staticData: { title: "Chat" },
	component: ChatRoute,
});

type Source = { documentId: string; chunkId: string; content: string };

type Message = {
	id: string;
	role: "user" | "assistant";
	content: string;
	sources?: Source[];
};

type Conversation =
	RouterOutputs["conversations"]["listConversations"]["conversations"][number];

const newId = () => crypto.randomUUID();

function isInsufficientCredits(err: unknown) {
	return (
		err instanceof ORPCError &&
		err.code === "FORBIDDEN" &&
		/credits/i.test(err.message)
	);
}

function isAbort(err: unknown) {
	return (
		(err instanceof DOMException && err.name === "AbortError") ||
		(err instanceof Error && err.name === "AbortError")
	);
}

/** Remounts the chat when the active organization changes, dropping its state. */
function ChatRoute() {
	const { data: activeOrg } = authClient.useActiveOrganization();
	return <ChatPage key={activeOrg?.id ?? "none"} />;
}

function ChatPage() {
	const queryClient = useQueryClient();
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	// Messages built locally while chatting. While null, the messages of the
	// selected conversation come straight from the server.
	const [localMessages, setLocalMessages] = useState<Message[] | null>(null);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [selectedProfileId, setSelectedProfileId] = useState<string>("none");
	const [deletingConvId, setDeletingConvId] = useState<string | null>(null);

	// Leaving the page cancels the in-flight request (and the spend behind it)
	useEffect(() => () => abortRef.current?.abort(), []);

	const { data: convData, isLoading: convsLoading } = useQuery(
		orpc.conversations.listConversations.queryOptions({ input: { limit: 50 } }),
	);

	const { data: profilesData } = useQuery(
		orpc.profiles.listProfiles.queryOptions({ input: { limit: 50 } }),
	);

	const conversations: Conversation[] = convData?.conversations ?? [];
	const profiles = profilesData?.profiles ?? [];

	// Server messages of the selected conversation. Not fetched once local
	// messages exist, so a refetch can never overwrite a stream in progress.
	const { data: convWithMessages, isLoading: messagesLoading } = useQuery({
		...orpc.conversations.getConversationWithMessages.queryOptions({
			input: { id: activeConvId ?? "" },
		}),
		enabled: !!activeConvId && localMessages === null,
		refetchOnWindowFocus: false,
	});

	const serverMessages: Message[] =
		activeConvId && convWithMessages?.id === activeConvId
			? convWithMessages.messages.flatMap((m) =>
					m.role === "user" || m.role === "assistant"
						? [{ id: m.id, role: m.role, content: m.content }]
						: [],
				)
			: [];
	const messages = localMessages ?? serverMessages;

	const deleteConvMutation = useMutation(
		orpc.conversations.deleteConversation.mutationOptions({
			onSuccess: (_data, variables) => {
				toast.success("Conversation deleted");
				setDeletingConvId(null);
				if (activeConvId === variables.id) {
					setActiveConvId(null);
					setLocalMessages(null);
				}
				void queryClient.invalidateQueries({
					queryKey: orpc.conversations.listConversations.key(),
				});
			},
			onError: (err) => toast.error(errorMessage(err, "Failed to delete")),
		}),
	);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleNewConversation = () => {
		if (isStreaming) return;
		setActiveConvId(null);
		setLocalMessages(null);
	};

	const handleSelectConversation = (conv: Conversation) => {
		if (isStreaming || conv.id === activeConvId) return;
		// Drop any cached copy so the conversation always loads fresh
		queryClient.removeQueries({
			queryKey: orpc.conversations.getConversationWithMessages.key({
				input: { id: conv.id },
			}),
		});
		setLocalMessages(null);
		setActiveConvId(conv.id);
		setSelectedProfileId(conv.profileId ?? "none");
	};

	const handleStop = () => abortRef.current?.abort();

	const handleSend = async () => {
		const query = input.trim();
		if (!query || isStreaming) return;

		const controller = new AbortController();
		abortRef.current = controller;

		const userMessage: Message = { id: newId(), role: "user", content: query };
		const assistantId = newId();
		const base = messages;

		setInput("");
		setIsStreaming(true);
		setLocalMessages([
			...base,
			userMessage,
			{ id: assistantId, role: "assistant", content: "" },
		]);

		const updateAssistant = (patch: (m: Message) => Message) =>
			setLocalMessages((prev) =>
				prev ? prev.map((m) => (m.id === assistantId ? patch(m) : m)) : prev,
			);

		let assistantContent = "";
		let streamConvId: string | null = activeConvId;

		try {
			const stream = await orpcClient.chat.queryStream(
				{
					query,
					conversationId: activeConvId ?? undefined,
					options: {
						profileId:
							selectedProfileId !== "none" ? selectedProfileId : undefined,
					},
				},
				{ signal: controller.signal },
			);

			for await (const chunk of stream) {
				if (chunk.type === "conversation_id") {
					// First for existing conversations, last for new ones
					streamConvId = chunk.data;
				} else if (chunk.type === "sources" && Array.isArray(chunk.data)) {
					const sources = chunk.data.map((r) => ({
						documentId: r.documentId,
						chunkId: r.chunkId,
						content: r.content,
					}));
					updateAssistant((m) => ({ ...m, sources }));
				} else if (chunk.type === "token") {
					assistantContent += chunk.data;
					const content = assistantContent;
					updateAssistant((m) => ({ ...m, content }));
				} else if (chunk.type === "tool_calls") {
					// Tools run in the API client, which posts results to /chat/continue
					const names = chunk.data.calls.map((c) => c.name).join(", ");
					toast.info(
						`The model asked to call ${names}. Tools run in your API client; this chat cannot run them.`,
					);
				}
			}
		} catch (err) {
			const aborted = isAbort(err);
			if (!aborted) {
				toast.error(
					isInsufficientCredits(err)
						? "Not enough credits to send this message. Ask an owner or admin to top up."
						: errorMessage(err, "Chat failed"),
				);
			}
			// The API stores an exchange only after a complete answer, so a stopped
			// or failed turn is not on the server: roll it back and give the text back.
			setInput((current) => current || query);
			if (assistantContent && !streamConvId) {
				// New conversation never created: start clean, not a hidden fork
				setLocalMessages(null);
				setActiveConvId(null);
				toast.info("Stopped. The partial answer was not saved.");
			} else if (assistantContent) {
				// Existing conversation: show what the server really has
				queryClient.removeQueries({
					queryKey: orpc.conversations.getConversationWithMessages.key({
						input: { id: streamConvId ?? "" },
					}),
				});
				setLocalMessages(null);
				toast.info("Stopped. The partial answer was not saved.");
			} else {
				setLocalMessages((prev) =>
					prev
						? prev.filter((m) => m.id !== userMessage.id && m.id !== assistantId)
						: prev,
				);
			}
		} finally {
			abortRef.current = null;
			setIsStreaming(false);
		}

		if (streamConvId && streamConvId !== activeConvId) {
			// New conversation: the id only arrives once the answer is stored
			setActiveConvId(streamConvId);
		}
		void queryClient.invalidateQueries({
			queryKey: orpc.conversations.listConversations.key(),
		});
		// The request spent credits (even when stopped part-way)
		void queryClient.invalidateQueries({ queryKey: orpc.credits.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.usage.key() });
	};

	const showEmpty = messages.length === 0 && !messagesLoading;

	return (
		<>
			<div className="flex h-full gap-0 overflow-hidden">
				{/* Conversation Sidebar */}
				<div className="w-64 border-r border-border flex flex-col shrink-0">
					<div className="p-3 border-b border-border">
						<Button
							variant="outline"
							className="w-full gap-2"
							onClick={handleNewConversation}
							disabled={isStreaming}
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
							conversations.map((conv) => (
								<div
									key={conv.id}
									className={cn(
										"group flex items-center justify-between rounded-md hover:bg-muted/60 transition-colors",
										activeConvId === conv.id && "bg-muted",
									)}
								>
									<button
										type="button"
										className="flex-1 min-w-0 p-2 text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
										aria-current={activeConvId === conv.id ? "true" : undefined}
										disabled={isStreaming}
										onClick={() => handleSelectConversation(conv)}
									>
										<p className="text-sm font-medium truncate">
											{conv.title || "Untitled"}
										</p>
										<p className="text-xs text-muted-foreground">
											{conv.createdAt
												? format(new Date(conv.createdAt), "MMM d")
												: ""}
										</p>
									</button>
									<Button
										variant="ghost"
										size="icon"
										className="size-6 mr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive shrink-0"
										aria-label={`Delete conversation ${conv.title || "Untitled"}`}
										disabled={isStreaming}
										onClick={() => setDeletingConvId(conv.id)}
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
					<div className="flex-1 overflow-y-auto p-4 space-y-4" aria-live="polite">
						{messagesLoading ? (
							<div className="space-y-4">
								<Skeleton className="h-10 w-2/3" />
								<Skeleton className="h-16 w-3/4 ml-auto" />
							</div>
						) : showEmpty ? (
							<div className="flex flex-col items-center justify-center h-full text-muted-foreground">
								<IconRobot className="size-12 opacity-20 mb-3" />
								<p className="text-sm">Start a conversation</p>
							</div>
						) : (
							messages.map((msg, i) => (
								<div
									key={msg.id}
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
											"max-w-[80%] rounded-xl px-4 py-2.5 text-sm break-words",
											msg.role === "user"
												? "bg-primary text-primary-foreground whitespace-pre-wrap"
												: "bg-muted",
										)}
									>
										{msg.content ? (
											msg.role === "assistant" ? (
												<Markdown>{msg.content}</Markdown>
											) : (
												msg.content
											)
										) : (isStreaming && i === messages.length - 1 ? (
												<span className="inline-block w-2 h-4 bg-current animate-pulse rounded" />
											) : null)}
										{msg.sources && msg.sources.length > 0 && (
											<details className="mt-2 text-xs text-muted-foreground whitespace-normal">
												<summary className="cursor-pointer">
													{msg.sources.length} source
													{msg.sources.length === 1 ? "" : "s"}
												</summary>
												<ol className="mt-1 list-decimal space-y-1 pl-4">
													{msg.sources.map((src) => (
														<li key={src.chunkId} className="line-clamp-3">
															{src.content}
														</li>
													))}
												</ol>
											</details>
										)}
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
								disabled={isStreaming || !!activeConvId}
							>
								<SelectTrigger className="w-44" aria-label="Profile">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No profile</SelectItem>
									{profiles.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex gap-2">
							<Input
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="Ask anything..."
								aria-label="Message"
								readOnly={isStreaming}
								onKeyDown={(e) => {
									if (
										e.key === "Enter" &&
										!e.shiftKey &&
										!e.nativeEvent.isComposing
									) {
										e.preventDefault();
										void handleSend();
									}
								}}
							/>
							{isStreaming ? (
								<Button
									onClick={handleStop}
									size="icon"
									variant="outline"
									aria-label="Stop generating"
								>
									<IconPlayerStop className="size-4" />
								</Button>
							) : (
								<Button
									onClick={() => void handleSend()}
									disabled={!input.trim()}
									size="icon"
									aria-label="Send message"
								>
									<IconSend className="size-4" />
								</Button>
							)}
							{isStreaming && (
								<IconLoader2
									className="size-4 animate-spin self-center text-muted-foreground"
									aria-hidden="true"
								/>
							)}
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
		</>
	);
}
