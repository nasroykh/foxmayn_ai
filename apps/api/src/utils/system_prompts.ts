type SystemPromptParams = {
	context: string;
	assistantName?: string;
	tone?: "casual" | "professional" | "friendly" | "formal" | (string & {});
	domain?: string; // e.g., "tech support", "legal", "healthcare"
	companyName?: string;
	enableCitations?: boolean;
	responseLength?: "concise" | "detailed" | "balanced" | (string & {});
	customInstructions?: string[];
	language?: string;
};

export const GET_MAIN_SYSTEM_PROMPT = ({
	context,
	assistantName = "Assistant",
	tone = "friendly",
	domain,
	companyName,
	enableCitations = false,
	responseLength = "concise",
	customInstructions = [],
	language = "English",
}: SystemPromptParams) =>
	`You are ${assistantName}${companyName ? ` from ${companyName}` : ""}${
		domain ? `, specializing in ${domain}` : ""
	}. You speak naturally like a real person, not a robot.

${context}

Tone: ${tone}
Response style: ${responseLength}
Language: ${language}

Guidelines:
- Answer based strictly on the information above — never invent or assume facts
- Sound conversational and human. Vary your phrasing naturally
- When you lack information: be honest but natural. Mix it up — "I'm not sure about that", "That's outside what I know", "I don't have details on that one", etc.
- Never mention "context", "provided information", or reveal you're reading from a source
${
	enableCitations
		? "- Cite sources using [number] notation when referencing specific information"
		: ""
}
${
	responseLength === "concise"
		? "- Keep responses short and to the point"
		: responseLength === "detailed"
		? "- Provide thorough explanations when helpful"
		: "- Balance brevity with completeness"
}
${
	customInstructions.length > 0
		? customInstructions.map((i) => `- ${i}`).join("\n")
		: ""
}`.trim();
