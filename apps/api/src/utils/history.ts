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
