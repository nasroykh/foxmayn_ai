import { z } from "zod";
import { env } from "./env";

// Base URL helper (same pattern as trpc.ts)
const getBaseUrl = () => {
	return env.VITE_IS_DEV ? env.VITE_API_URL_DEV : env.VITE_API_URL;
};

// Response schemas
const documentSchema = z.object({
	id: z.string(),
	title: z.string(),
	source: z.string().nullish(),
	status: z.string(),
	chunkCount: z.number().nullish(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const listDocumentsResponseSchema = z.object({
	documents: z.array(documentSchema),
	total: z.number(),
});

const createDocumentResponseSchema = z.object({
	documentId: z.string(),
	jobId: z.string().optional(),
	message: z.string(),
	status: z.string(),
});

const searchResultSchema = z.object({
	documentId: z.string(),
	chunkId: z.string(),
	content: z.string(),
	score: z.number(),
});

const queryResponseSchema = z.object({
	answer: z.string(),
	sources: z.array(searchResultSchema),
});

const searchResponseSchema = z.object({
	results: z.array(searchResultSchema),
});

// Types
export type Document = z.infer<typeof documentSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type QueryResponse = z.infer<typeof queryResponseSchema>;

// Fetch helper with credentials
const apiFetch = async (path: string, options: RequestInit = {}) => {
	const url = `${getBaseUrl()}${path}`;
	const response = await fetch(url, {
		...options,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...options.headers,
		},
	});

	if (!response.ok) {
		const error = await response
			.json()
			.catch(() => ({ error: "Request failed" }));
		throw new Error(
			error.error || `Request failed with status ${response.status}`
		);
	}

	return response;
};

// Document APIs
export const listDocuments = async (params?: {
	limit?: number;
	offset?: number;
}) => {
	const searchParams = new URLSearchParams();
	if (params?.limit) searchParams.set("limit", params.limit.toString());
	if (params?.offset) searchParams.set("offset", params.offset.toString());

	const queryString = searchParams.toString();
	const path = `/documents${queryString ? `?${queryString}` : ""}`;

	const response = await apiFetch(path);
	const data = await response.json();
	return listDocumentsResponseSchema.parse(data);
};

export const getDocument = async (id: string) => {
	const response = await apiFetch(`/documents/${id}`);
	const data = await response.json();
	return documentSchema.parse(data);
};

export const createDocument = async (payload: {
	title: string;
	content: string;
	source?: string;
	metadata?: Record<string, unknown>;
}) => {
	const response = await apiFetch("/documents", {
		method: "POST",
		body: JSON.stringify(payload),
	});
	const data = await response.json();
	return createDocumentResponseSchema.parse(data);
};

export const uploadDocumentFile = async (params: {
	file: File;
	title?: string;
	source?: string;
	metadata?: Record<string, unknown>;
}) => {
	const formData = new FormData();
	formData.append("file", params.file);
	if (params.title) formData.append("title", params.title);
	if (params.source) formData.append("source", params.source);
	if (params.metadata)
		formData.append("metadata", JSON.stringify(params.metadata));

	const url = `${getBaseUrl()}/documents/upload`;
	const response = await fetch(url, {
		method: "POST",
		credentials: "include",
		body: formData,
	});

	if (!response.ok) {
		const error = await response
			.json()
			.catch(() => ({ error: "Upload failed" }));
		throw new Error(
			error.error || `Upload failed with status ${response.status}`
		);
	}

	const data = await response.json();
	return createDocumentResponseSchema.parse(data);
};

export const deleteDocument = async (id: string) => {
	await apiFetch(`/documents/${id}`, {
		method: "DELETE",
		body: JSON.stringify({}),
	});
};

// Chat APIs
export const ragQuery = async (params: {
	query: string;
	options?: {
		limit?: number;
		scoreThreshold?: number;
		documentId?: string;
		source?: string;
	};
}) => {
	const response = await apiFetch("/chat/query", {
		method: "POST",
		body: JSON.stringify(params),
	});
	const data = await response.json();
	return queryResponseSchema.parse(data);
};

export const ragSearch = async (params: {
	query: string;
	options?: {
		limit?: number;
		scoreThreshold?: number;
		documentId?: string;
		source?: string;
	};
}) => {
	const response = await apiFetch("/chat/search", {
		method: "POST",
		body: JSON.stringify(params),
	});
	const data = await response.json();
	return searchResponseSchema.parse(data);
};

// SSE streaming helper
export const ragStream = async (
	params: {
		query: string;
		options?: {
			limit?: number;
			scoreThreshold?: number;
			documentId?: string;
			source?: string;
		};
	},
	callbacks: {
		onSources?: (sources: SearchResult[]) => void;
		onToken?: (token: string) => void;
		onDone?: () => void;
		onError?: (error: string) => void;
	},
	abortController?: AbortController
) => {
	const response = await fetch(`${getBaseUrl()}/chat/query/stream`, {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(params),
		signal: abortController?.signal,
	});

	if (!response.ok) {
		const error = await response
			.json()
			.catch(() => ({ error: "Stream failed" }));
		throw new Error(
			error.error || `Stream failed with status ${response.status}`
		);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("No response body");

	const decoder = new TextDecoder();
	let buffer = "";
	let currentEvent = "";

	const handleEvent = (event: string, data: string) => {
		switch (event) {
			case "sources":
				try {
					callbacks.onSources?.(JSON.parse(data));
				} catch {
					// ignore parse errors
				}
				break;
			case "token":
				callbacks.onToken?.(data);
				break;
			case "done":
				callbacks.onDone?.();
				break;
			case "error":
				try {
					const errorData = JSON.parse(data);
					callbacks.onError?.(errorData.message || "Unknown error");
				} catch {
					callbacks.onError?.(data || "Unknown error");
				}
				break;
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (line.startsWith("event: ")) {
					currentEvent = line.slice(7).trim();
				} else if (line.startsWith("data: ")) {
					handleEvent(currentEvent, line.slice(6));
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
};
