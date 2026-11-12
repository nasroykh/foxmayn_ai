import { useEffect, useRef, useState } from "react";
import { ORPCError } from "@orpc/client";
import {
	IconLoader2,
	IconPlayerStop,
	IconRobot,
	IconSend,
	IconUser,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { orpcClient } from "@/lib/orpc";
import { citedSources } from "@/lib/cited-sources";
import { rateLimitMessage, type PublicSiteInfo } from "@/lib/public-site";
import { cn } from "@/lib/utils";

// Limits of POST /public/chat/stream
const QUERY_MAX_CHARS = 1000;
const HISTORY_MAX_MESSAGES = 10;
const HISTORY_MESSAGE_MAX_CHARS = 4000;

type Source = { title: string; source: string | null };

type Message = {
	id: string;
	role: "user" | "assistant";
	content: string;
	sources?: Source[];
};

const newId = () => crypto.randomUUID();

function isAbort(err: unknown) {
	return (
		(err instanceof DOMException && err.name === "AbortError") ||
		(err instanceof Error && err.name === "AbortError")
	);
}

/** A friendly line for a failed request; the API's wording is not shown to visitors. */
function friendlyError(err: unknown, rateLimitText: string | undefined): string {
	if (err instanceof ORPCError) {
		if (err.status === 429 || err.code === "TOO_MANY_REQUESTS") {
			const wait = (err.data as { retryAfterSeconds?: unknown } | undefined)
				?.retryAfterSeconds;
			return rateLimitMessage(rateLimitText, wait);
		}
		if (err.code === "FORBIDDEN" || err.code === "SERVICE_UNAVAILABLE") {
			return "L’assistant n’est pas disponible pour le moment. Réessayez plus tard.";
		}
	}
	return "Une erreur est survenue. Réessayez.";
}

/** Only web links become links: a source can be any string (a file name, a path). */
function httpUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

function SourceList({ content, sources }: { content: string; sources: Source[] }) {
	const cited = citedSources(content, sources);
	if (cited.length === 0) return null;
	return (
		<div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
			<p className="mb-1 font-medium">Sources</p>
			{/* Only cited documents, each with the [n] numbers the answer uses */}
			<ol className="space-y-0.5">
				{cited.map((src) => {
					const href = httpUrl(src.source);
					return (
						<li key={src.numbers[0]} dir="auto">
							{src.numbers.map((n) => `[${n}]`).join("")}{" "}
							{href ? (
								<a
									href={href}
									target="_blank"
									rel="noopener noreferrer"
									className="underline underline-offset-2 hover:text-foreground"
								>
									{src.title}
								</a>
							) : (
								src.title
							)}
						</li>
					);
				})}
			</ol>
		</div>
	);
}

export function PublicChat({ site }: { site: PublicSiteInfo }) {
	const { settings } = site;
	const endRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const title =
		settings.title ||
		(site.companyName
			? `${site.assistantName} — ${site.companyName}`
			: site.assistantName);

	useEffect(() => {
		document.title = title;
	}, [title]);

	// Leaving the page cancels the in-flight request (and the spend behind it)
	useEffect(() => () => abortRef.current?.abort(), []);

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [messages]);

	const send = async (text: string) => {
		const query = text.trim().slice(0, QUERY_MAX_CHARS);
		if (!query || isStreaming) return;

		const controller = new AbortController();
		abortRef.current = controller;

		// The last turns of the conversation so far, within the API's limits
		const history = messages
			.filter((m) => m.content)
			.slice(-HISTORY_MAX_MESSAGES)
			.map((m) => ({
				role: m.role,
				content: m.content.slice(0, HISTORY_MESSAGE_MAX_CHARS),
			}));

		const userMessage: Message = { id: newId(), role: "user", content: query };
		const assistantId = newId();
		setError(null);
		setInput("");
		setIsStreaming(true);
		setMessages((prev) => [
			...prev,
			userMessage,
			{ id: assistantId, role: "assistant", content: "" },
		]);

		const updateAssistant = (patch: (m: Message) => Message) =>
			setMessages((prev) =>
				prev.map((m) => (m.id === assistantId ? patch(m) : m)),
			);

		let answer = "";
		try {
			const stream = await orpcClient.public.chatStream(
				{ query, messages: history },
				{ signal: controller.signal },
			);
			for await (const chunk of stream) {
				if (chunk.type === "sources" && Array.isArray(chunk.data)) {
					const sources = chunk.data.map((r) => ({
						title: r.title || r.source || "Source",
						source: r.source,
					}));
					updateAssistant((m) => ({ ...m, sources }));
				} else if (chunk.type === "token") {
					answer += chunk.data;
					const content = answer;
					updateAssistant((m) => ({ ...m, content }));
				}
			}
		} catch (err) {
			if (!isAbort(err)) setError(friendlyError(err, settings.rateLimitText));
			// Nothing is stored server side: drop the turn and give the text back
			setInput((current) => current || query);
			setMessages((prev) =>
				prev.filter((m) => m.id !== userMessage.id && m.id !== assistantId),
			);
		} finally {
			abortRef.current = null;
			setIsStreaming(false);
		}
	};

	const suggestions = settings.suggestions ?? [];
	const showEmpty = messages.length === 0;

	return (
		<div className="flex h-dvh flex-col bg-background text-foreground">
			<header className="border-b border-border px-4 py-3">
				<div className="mx-auto w-full max-w-3xl">
					<h1 className="text-base font-semibold" dir="auto">
						{title}
					</h1>
					{settings.subtitle ? (
						<p className="text-sm text-muted-foreground" dir="auto">
							{settings.subtitle}
						</p>
					) : null}
				</div>
			</header>

			<main className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
				<div className="mx-auto w-full max-w-3xl space-y-4">
					{showEmpty ? (
						<div className="flex flex-col items-center gap-4 py-10 text-center text-muted-foreground">
							<IconRobot className="size-12 opacity-20" aria-hidden="true" />
							<p className="text-sm" dir="auto">
								{site.assistantName}
							</p>
							{suggestions.length > 0 && (
								<div className="flex flex-wrap justify-center gap-2">
									{suggestions.map((suggestion) => (
										<Button
											key={suggestion}
											variant="outline"
											className="h-auto max-w-full whitespace-normal px-3 py-1.5 text-start"
											disabled={isStreaming}
											onClick={() => void send(suggestion)}
										>
											<span dir="auto">{suggestion}</span>
										</Button>
									))}
								</div>
							)}
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
										"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
										msg.role === "user"
											? "bg-primary text-primary-foreground"
											: "border border-border bg-muted",
									)}
								>
									{msg.role === "user" ? (
										<IconUser className="size-4" aria-hidden="true" />
									) : (
										<IconRobot className="size-4" aria-hidden="true" />
									)}
								</div>
								<div
									dir="auto"
									className={cn(
										"max-w-[85%] break-words rounded-xl px-4 py-2.5 text-sm",
										msg.role === "user"
											? "whitespace-pre-wrap bg-primary text-primary-foreground"
											: "bg-muted",
									)}
								>
									{msg.content ? (
										msg.role === "assistant" ? (
											<Markdown>{msg.content}</Markdown>
										) : (
											msg.content
										)
									) : isStreaming && i === messages.length - 1 ? (
										<span className="inline-block h-4 w-2 animate-pulse rounded bg-current" />
									) : null}
									{msg.sources && msg.sources.length > 0 && msg.content ? (
										<SourceList content={msg.content} sources={msg.sources} />
									) : null}
								</div>
							</div>
						))
					)}
					<div ref={endRef} />
				</div>
			</main>

			<footer className="border-t border-border bg-background px-4 py-3">
				<div className="mx-auto w-full max-w-3xl space-y-2">
					{error ? (
						<p role="alert" className="text-sm text-destructive" dir="auto">
							{error}
						</p>
					) : null}
					<div className="flex gap-2">
						<Input
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={settings.placeholder || "Posez votre question..."}
							aria-label="Message"
							dir="auto"
							maxLength={QUERY_MAX_CHARS}
							readOnly={isStreaming}
							className="h-10"
							onKeyDown={(e) => {
								if (
									e.key === "Enter" &&
									!e.shiftKey &&
									!e.nativeEvent.isComposing
								) {
									e.preventDefault();
									void send(input);
								}
							}}
						/>
						{isStreaming ? (
							<Button
								onClick={() => abortRef.current?.abort()}
								size="icon-lg"
								variant="outline"
								aria-label="Arrêter"
							>
								<IconPlayerStop className="size-4" />
							</Button>
						) : (
							<Button
								onClick={() => void send(input)}
								disabled={!input.trim()}
								size="icon-lg"
								aria-label="Envoyer"
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
					{settings.disclaimer ? (
						<p className="text-xs text-muted-foreground" dir="auto">
							{settings.disclaimer}
						</p>
					) : null}
					{settings.supportText ? (
						<p className="text-xs text-muted-foreground" dir="auto">
							{settings.supportText}
						</p>
					) : null}
				</div>
			</footer>
		</div>
	);
}
