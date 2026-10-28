/**
 * Chat history selection. Pure so it can be unit tested.
 */

export interface HistoryMessage {
	role: "user" | "assistant";
	content: string;
}

export const HISTORY_MAX_MESSAGES = 20;
export const HISTORY_MAX_TOKENS = 6000;

// Limits for client-managed `messages`
export const CLIENT_MESSAGES_MAX_COUNT = 50;
export const CLIENT_MESSAGES_MAX_CHARS = 100_000;

// Cap on the text embedded for retrieval (previous user turn + query)
export const RETRIEVAL_QUERY_MAX_CHARS = 1000;

/** The first `max` UTF-16 units of `text`, without splitting a surrogate pair. */
const truncate = (text: string, max: number): string => {
	if (text.length <= max) return text;
	const last = text.charCodeAt(max - 1);
	// A high surrogate at the cut would leave half a character
	return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
};

/**
 * Text to embed for retrieval: the previous user turn, then the query. A
 * follow-up such as "does it run on Windows?" then still finds the subject of
 * the conversation. Retrieval only: the model still receives the full query.
 *
 * At most RETRIEVAL_QUERY_MAX_CHARS: the query comes first in the budget (cut
 * itself when longer), the previous turn fills what is left.
 *
 * @param history earlier turns, oldest to newest, without the current query
 */
export function buildRetrievalQuery(
	query: string,
	history: ReadonlyArray<{ role: string; content: string }>,
): string {
	const retrievalQuery = truncate(query, RETRIEVAL_QUERY_MAX_CHARS);
	let previous = "";
	for (let i = history.length - 1; i >= 0 && !previous; i--) {
		if (history[i].role === "user") previous = history[i].content.trim();
	}
	const room = RETRIEVAL_QUERY_MAX_CHARS - retrievalQuery.length - 1;
	if (!previous || room <= 0) return retrievalQuery;
	const context = truncate(previous, room);
	return context ? `${context}\n${retrievalQuery}` : retrievalQuery;
}

/**
 * Pick the most recent turns that fit the message and token budgets.
 *
 * @param newestFirst stored messages ordered newest to oldest
 * @returns the selected messages, oldest to newest (ready to send to the model)
 */
export function selectHistory(
	newestFirst: Array<{ role: string; content: string }>,
	options: {
		countTokens: (text: string) => number;
		maxMessages?: number;
		maxTokens?: number;
	},
): HistoryMessage[] {
	const {
		countTokens,
		maxMessages = HISTORY_MAX_MESSAGES,
		maxTokens = HISTORY_MAX_TOKENS,
	} = options;

	const selected: HistoryMessage[] = [];
	let tokens = 0;

	for (const m of newestFirst) {
		// Stored `system` rows are never replayed to the model
		if (m.role !== "user" && m.role !== "assistant") continue;
		if (selected.length >= maxMessages) break;

		const t = countTokens(m.content);
		// Stop at the first message that does not fit so the history stays contiguous
		if (tokens + t > maxTokens) break;

		tokens += t;
		selected.push({ role: m.role, content: m.content });
	}

	return selected.reverse();
}
