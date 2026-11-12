import { useEffect, useRef, useState } from "react";
import { ORPCError } from "@orpc/client";
import {
	IconArrowUp,
	IconBrandWhatsapp,
	IconMail,
	IconMoon,
	IconPlayerStopFilled,
	IconSun,
	IconWorld,
} from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import { themeAtom } from "@/atoms/global";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { orpcClient } from "@/lib/orpc";
import { BRAND } from "@/lib/brand";
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
	const chip =
		"inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground";
	return (
		// Only cited documents, each with the [n] numbers the answer uses
		<ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Sources">
			{cited.map((src) => {
				const href = httpUrl(src.source);
				const label = (
					<>
						<span className="font-medium tabular-nums text-foreground/70">
							{src.numbers.join(", ")}
						</span>
						<span className="truncate" dir="auto">
							{src.title}
						</span>
					</>
				);
				return (
					<li key={src.numbers[0]} className="max-w-full">
						{href ? (
							<a
								href={href}
								target="_blank"
								rel="noopener noreferrer"
								className={cn(chip, "transition-colors hover:border-foreground/30 hover:text-foreground")}
							>
								{label}
							</a>
						) : (
							<span className={chip}>{label}</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** The Foxmayn fox, white on a dark tile. The image is a luminance mask. */
function FoxTile({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center rounded-[28%] bg-neutral-950 text-white dark:bg-white/10",
				className,
			)}
		>
			<span className="block aspect-[454/512] h-[62%] bg-current [mask:url(/brand/foxmayn-mark.png)_center/contain_no-repeat]" />
		</span>
	);
}

const BRAND_LINKS = [
	{ label: BRAND.siteLabel, href: BRAND.siteUrl, icon: IconWorld },
	{ label: BRAND.email, href: `mailto:${BRAND.email}`, icon: IconMail },
	{ label: `WhatsApp ${BRAND.phoneDisplay}`, href: BRAND.whatsappUrl, icon: IconBrandWhatsapp },
];

export function PublicChat({ site }: { site: PublicSiteInfo }) {
	const { settings } = site;
	const endRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const setTheme = useSetAtom(themeAtom);
	// From what is shown now, so the first click also leaves "system"
	const toggleTheme = () =>
		setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");

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
		<div className="public-chat flex h-dvh flex-col bg-background text-foreground">
			<header className="border-b border-border/70 px-4 py-2.5">
				<div className="mx-auto flex w-full max-w-2xl items-center gap-3">
					<a
						href={BRAND.siteUrl}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={`${BRAND.name}, ${BRAND.siteLabel}`}
						className="transition-opacity hover:opacity-80"
					>
						<FoxTile className="size-9" />
					</a>
					<div className="min-w-0">
						<h1 className="truncate text-sm font-semibold leading-tight" dir="auto">
							{title}
						</h1>
						{settings.subtitle ? (
							<p className="truncate text-xs text-muted-foreground" dir="auto">
								{settings.subtitle}
							</p>
						) : null}
					</div>
					<Button
						onClick={toggleTheme}
						size="icon"
						variant="ghost"
						className="ms-auto shrink-0 rounded-xl text-muted-foreground"
						aria-label="Thème clair ou sombre"
						title="Thème clair ou sombre"
					>
						<IconMoon className="size-4 dark:hidden" aria-hidden="true" />
						<IconSun className="hidden size-4 dark:block" aria-hidden="true" />
					</Button>
				</div>
			</header>

			<main className="flex-1 overflow-y-auto px-4" aria-live="polite">
				<div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-5 py-5">
					{showEmpty ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
							<FoxTile className="size-14" />
							<p className="text-lg font-semibold" dir="auto">
								{site.assistantName}
							</p>
							{suggestions.length > 0 && (
								<div className="grid w-full gap-2 sm:grid-cols-2">
									{suggestions.map((suggestion) => (
										<button
											key={suggestion}
											type="button"
											disabled={isStreaming}
											onClick={() => void send(suggestion)}
											className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-start text-sm text-foreground/80 transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
										>
											<span dir="auto" className="block">
												{suggestion}
											</span>
										</button>
									))}
								</div>
							)}
							{settings.supportText ? (
								<p className="text-xs text-muted-foreground" dir="auto">
									{settings.supportText}
								</p>
							) : null}
						</div>
					) : (
						messages.map((msg, i) =>
							msg.role === "user" ? (
								<div key={msg.id} className="flex justify-end">
									<div
										dir="auto"
										className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
									>
										{msg.content}
									</div>
								</div>
							) : (
								<div key={msg.id} className="flex gap-2.5">
									<FoxTile className="mt-0.5 size-7" />
									<div dir="auto" className="min-w-0 max-w-[88%] break-words text-sm">
										<div className="rounded-2xl rounded-ss-md bg-muted px-4 py-2.5">
											{msg.content ? (
												<Markdown>{msg.content}</Markdown>
											) : isStreaming && i === messages.length - 1 ? (
												<span className="flex h-5 items-center gap-1" aria-label="…">
													<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
													<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
													<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
												</span>
											) : null}
										</div>
										{msg.sources && msg.sources.length > 0 && msg.content ? (
											<SourceList content={msg.content} sources={msg.sources} />
										) : null}
									</div>
								</div>
							),
						)
					)}
					<div ref={endRef} />
				</div>
			</main>

			<footer className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
				<div className="mx-auto w-full max-w-2xl space-y-2">
					{error ? (
						<p role="alert" className="text-sm text-destructive" dir="auto">
							{error}
						</p>
					) : null}
					<div className="flex items-center gap-1.5 rounded-2xl border border-border bg-background p-1.5 shadow-sm transition-colors focus-within:border-primary/60">
						<Input
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={settings.placeholder || "Posez votre question…"}
							aria-label="Message"
							dir="auto"
							maxLength={QUERY_MAX_CHARS}
							readOnly={isStreaming}
							// 16px on phones: a smaller size makes iOS zoom the page on focus
							className="h-9 border-0 bg-transparent px-2.5 text-base shadow-none focus-visible:ring-0 sm:text-sm dark:bg-transparent"
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
								size="icon"
								variant="secondary"
								className="shrink-0 rounded-xl"
								aria-label="Arrêter"
							>
								<IconPlayerStopFilled className="size-4" />
							</Button>
						) : (
							<Button
								onClick={() => void send(input)}
								disabled={!input.trim()}
								size="icon"
								className="shrink-0 rounded-xl"
								aria-label="Envoyer"
							>
								<IconArrowUp className="size-4" />
							</Button>
						)}
					</div>
					<div className="flex items-center justify-between gap-3 text-[11px] leading-tight text-muted-foreground">
						<p className="min-w-0" dir="auto">
							{settings.disclaimer}
						</p>
						<div className="flex shrink-0 items-center gap-2.5">
							<a
								href={BRAND.siteUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium hover:text-foreground"
							>
								{BRAND.name}
							</a>
							{BRAND_LINKS.map((link) => (
								<a
									key={link.href}
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={link.label}
									title={link.label}
									className="hover:text-foreground"
								>
									<link.icon className="size-3.5" aria-hidden="true" />
								</a>
							))}
						</div>
					</div>
				</div>
			</footer>
		</div>
	);
}
