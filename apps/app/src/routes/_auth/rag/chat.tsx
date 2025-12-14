import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Send,
	StopCircle,
	Plus,
	MoreHorizontal,
	MessageSquare,
	Trash2,
	Pencil,
	Copy,
	RotateCcw,
	Bot,
	User,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ragStream } from "@/lib/rag";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/rag/chat")({
	component: ChatPage,
});

// Mock types
interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: Date;
}

interface Conversation {
	id: string;
	title: string;
	messages: Message[];
	updatedAt: Date;
}

// Mock models
const AI_MODELS = [
	{ id: "gpt-4o", name: "GPT-4o" },
	{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
	{ id: "llama-3-70b", name: "Llama 3 70B" },
];

function ChatPage() {
	// State
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id);
	const [isStreaming, setIsStreaming] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [activeId, conversations]);

	const activeConversation = conversations.find((c) => c.id === activeId);

	const handleCreateConversation = () => {
		const newId = crypto.randomUUID();
		const newConversation: Conversation = {
			id: newId,
			title: "New Chat",
			messages: [],
			updatedAt: new Date(),
		};
		setConversations([newConversation, ...conversations]);
		setActiveId(newId);
		setInput("");
	};

	const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		const newConversations = conversations.filter((c) => c.id !== id);
		setConversations(newConversations);
		if (activeId === id) {
			setActiveId(newConversations[0]?.id || null);
		}
		toast.success("Conversation deleted");
	};

	const handleRenameConversation = (id: string, newTitle: string) => {
		setConversations(
			conversations.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
		);
	};

	const handleSend = async () => {
		if (!input.trim() || isStreaming) return;

		let currentConversationId = activeId;
		let updatedConversations = [...conversations];

		// Create new conversation if none selected
		if (!currentConversationId) {
			currentConversationId = crypto.randomUUID();
			const newConversation: Conversation = {
				id: currentConversationId,
				title: input.slice(0, 30) + (input.length > 30 ? "..." : ""),
				messages: [],
				updatedAt: new Date(),
			};
			updatedConversations = [newConversation, ...conversations];
			setConversations(updatedConversations);
			setActiveId(currentConversationId);
		}

		// Add user message
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: "user",
			content: input,
			timestamp: new Date(),
		};

		const assistantMessageId = crypto.randomUUID();
		const assistantMessage: Message = {
			id: assistantMessageId,
			role: "assistant",
			content: "",
			timestamp: new Date(),
		};

		setConversations((prev) =>
			prev.map((c) =>
				c.id === currentConversationId
					? {
							...c,
							messages: [...c.messages, userMessage, assistantMessage],
							updatedAt: new Date(),
					  }
					: c
			)
		);

		setInput("");
		setIsStreaming(true);

		const controller = new AbortController();
		abortControllerRef.current = controller;

		try {
			await ragStream(
				{
					query: userMessage.content,
					// Note: Backend doesn't support model selection yet, so we don't send it
				},
				{
					onToken: (token) => {
						setConversations((prev) =>
							prev.map((c) => {
								if (c.id !== currentConversationId) return c;
								const messages = [...c.messages];
								const lastMsg = messages[messages.length - 1];
								if (lastMsg.id === assistantMessageId) {
									lastMsg.content += token;
								}
								return { ...c, messages };
							})
						);
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
				toast.error("Failed to send message");
			}
			setIsStreaming(false);
		}
	};

	const handleStop = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setIsStreaming(false);
	};

	const handleCopy = (content: string) => {
		navigator.clipboard.writeText(content);
		toast.success("Copied to clipboard");
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<Layout hideHeader>
			<div className="flex h-full overflow-hidden bg-background">
				{/* Sidebar */}
				<aside className="w-64 border-r bg-muted/10 flex flex-col">
					<div className="p-4 border-b">
						<Button
							variant="outline"
							className="w-full justify-start gap-2"
							onClick={handleCreateConversation}
						>
							<Plus className="size-4" />
							New Chat
						</Button>
					</div>
					<ScrollArea className="flex-1">
						<div className="p-2 space-y-1">
							{conversations.map((conv) => (
								<div
									key={conv.id}
									className={cn(
										"group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors",
										activeId === conv.id
											? "bg-accent text-accent-foreground"
											: ""
									)}
									onClick={() => setActiveId(conv.id)}
								>
									<MessageSquare className="size-4 shrink-0 text-muted-foreground" />
									<span className="truncate flex-1 text-left">
										{conv.title}
									</span>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
												onClick={(e) => e.stopPropagation()}
											>
												<MoreHorizontal className="size-3" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													// Mock rename
													const newTitle = prompt("New title", conv.title);
													if (newTitle)
														handleRenameConversation(conv.id, newTitle);
												}}
											>
												<Pencil className="mr-2 size-4" />
												Rename
											</DropdownMenuItem>
											<DropdownMenuItem
												className="text-destructive"
												onClick={(e) => handleDeleteConversation(conv.id, e)}
											>
												<Trash2 className="mr-2 size-4" />
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							))}
							{conversations.length === 0 && (
								<div className="text-center py-8 text-muted-foreground text-sm">
									No conversations yet
								</div>
							)}
						</div>
					</ScrollArea>
				</aside>

				{/* Main Chat Area */}
				<main className="flex-1 flex flex-col relative">
					<ScrollArea className="flex-1 p-4">
						<div className="max-w-3xl mx-auto space-y-6 pb-4">
							{activeConversation ? (
								activeConversation.messages.map((msg, idx) => (
									<div
										key={msg.id}
										className={cn(
											"flex gap-4 group",
											msg.role === "user" ? "flex-row-reverse" : "flex-row"
										)}
									>
										<div
											className={cn(
												"size-8 shrink-0 rounded-full flex items-center justify-center",
												msg.role === "user"
													? "bg-primary text-primary-foreground"
													: "bg-muted"
											)}
										>
											{msg.role === "user" ? (
												<User className="size-5" />
											) : (
												<Bot className="size-5" />
											)}
										</div>
										<div
											className={cn(
												"flex-1 max-w-[80%] space-y-2",
												msg.role === "user" ? "text-right" : "text-left"
											)}
										>
											<div
												className={cn(
													"rounded-lg p-4 prose prose-sm dark:prose-invert max-w-none wrap-break-word",
													msg.role === "user"
														? "bg-primary text-primary-foreground prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-code:text-primary-foreground"
														: "bg-muted"
												)}
											>
												<ReactMarkdown remarkPlugins={[remarkGfm]}>
													{msg.content}
												</ReactMarkdown>
												{msg.role === "assistant" &&
													isStreaming &&
													idx === activeConversation.messages.length - 1 && (
														<span className="inline-block w-2 h-4 bg-current animate-pulse ml-1 align-middle" />
													)}
											</div>
											<div
												className={cn(
													"flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
													msg.role === "user" ? "justify-end" : "justify-start"
												)}
											>
												<Button
													variant="ghost"
													size="icon"
													className="size-6"
													onClick={() => handleCopy(msg.content)}
													title="Copy"
												>
													<Copy className="size-3" />
												</Button>
												{msg.role === "user" && (
													<Button
														variant="ghost"
														size="icon"
														className="size-6"
														onClick={() => {
															setInput(msg.content);
														}}
														title="Edit"
													>
														<Pencil className="size-3" />
													</Button>
												)}
												<Button
													variant="ghost"
													size="icon"
													className="size-6"
													onClick={() => {
														// Mock retry by setting input
														if (msg.role === "user") {
															setInput(msg.content);
															// In real app, would trigger resend immediately or delete subsequent messages
														} else {
															// Find previous user message
															const prevUserMsg =
																activeConversation.messages[idx - 1];
															if (prevUserMsg) setInput(prevUserMsg.content);
														}
													}}
													title="Retry"
												>
													<RotateCcw className="size-3" />
												</Button>
											</div>
										</div>
									</div>
								))
							) : (
								<div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
									<div className="bg-muted p-4 rounded-full">
										<Bot className="size-12 text-muted-foreground" />
									</div>
									<h2 className="text-2xl font-bold">
										How can I help you today?
									</h2>
									<p className="text-muted-foreground max-w-md">
										Select a model and start chatting to get answers from your
										documents.
									</p>
								</div>
							)}
							<div ref={scrollRef} />
						</div>
					</ScrollArea>

					{/* Input Area */}
					<div className="p-4 bg-background border-t">
						<div className="max-w-3xl mx-auto space-y-4">
							<div className="relative">
								<Textarea
									placeholder="Type your message..."
									value={input}
									onChange={(e) => setInput(e.target.value)}
									onKeyDown={handleKeyDown}
									className="min-h-[100px] resize-none pr-24"
									disabled={isStreaming}
								/>
								<div className="absolute bottom-3 right-3 flex gap-2">
									{isStreaming ? (
										<Button
											size="sm"
											variant="destructive"
											onClick={handleStop}
											className="h-8 w-8 p-0 rounded-full"
										>
											<StopCircle className="size-4" />
										</Button>
									) : (
										<Button
											size="sm"
											onClick={handleSend}
											disabled={!input.trim()}
											className="h-8 w-8 p-0 rounded-full"
										>
											<Send className="size-4" />
										</Button>
									)}
								</div>
							</div>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Select
										value={selectedModel}
										onValueChange={setSelectedModel}
									>
										<SelectTrigger className="w-[180px] h-8 text-xs">
											<SelectValue placeholder="Select model" />
										</SelectTrigger>
										<SelectContent>
											{AI_MODELS.map((model) => (
												<SelectItem key={model.id} value={model.id}>
													{model.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>
					</div>
				</main>
			</div>
		</Layout>
	);
}
