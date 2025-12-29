import { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import { env } from "./config/env";
export type { QdrantClient, Schemas };

export type Distance = "Cosine" | "Euclid" | "Dot" | "Manhattan";
export type VectorSize = number;

export interface QdrantConfig {
	host?: string;
	port?: number;
	apiKey?: string;
	https?: boolean;
	url?: string;
}

export interface CreateCollectionOptions {
	size: VectorSize;
	distance?: Distance;
	textFields?: string[];
	dateTimeFields?: string[];
	keywordFields?: string[];
}

export interface UpsertOptions {
	wait?: boolean;
}

export interface SearchOptions {
	limit?: number;
	scoreThreshold?: number;
	filter?: Schemas["Filter"];
	withVector?: boolean;
}

export interface ScrollOptions {
	limit?: number;
	filter?: Schemas["Filter"];
	offset?: string | number;
	withVector?: boolean;
}

export interface Point<
	T extends Record<string, unknown> = Record<string, unknown>
> {
	id: string | number;
	vector: number[];
	payload: T;
}

/**
 * Creates a Qdrant client instance with configuration from environment or options
 */
export const createQdrantClient = (config: QdrantConfig): QdrantClient => {
	if (!config.url) throw new Error("QDRANT_URL is not set");

	return new QdrantClient({
		url: config.url,
		checkCompatibility: false,
	});
};

/**
 * Check if a collection exists
 */
export const collectionExists = async (
	client: QdrantClient,
	name: string
): Promise<boolean> => {
	const { exists } = await client.collectionExists(name);
	return exists;
};

/**
 * Create a collection with proper full-text indexing configuration
 */
export const createCollection = async (
	client: QdrantClient,
	name: string,
	options: CreateCollectionOptions
): Promise<void> => {
	const exists = await collectionExists(client, name);
	if (exists) return;

	const {
		size,
		distance = "Cosine",
		textFields = [],
		dateTimeFields = [],
		keywordFields = [],
	} = options;

	await client.createCollection(name, {
		vectors: { size, distance },
	});

	for (const field of textFields) {
		await client.createPayloadIndex(name, {
			field_name: field,
			field_schema: {
				type: "text",
				tokenizer: "word",
				min_token_len: 2,
				max_token_len: 20,
				lowercase: true,
			},
		});
	}

	for (const field of dateTimeFields) {
		await client.createPayloadIndex(name, {
			field_name: field,
			field_schema: "datetime",
		});
	}

	for (const field of keywordFields) {
		await client.createPayloadIndex(name, {
			field_name: field,
			field_schema: "keyword",
		});
	}
};

/**
 * Delete a collection (indexes are deleted automatically with the collection)
 */
export const deleteCollection = async (
	client: QdrantClient,
	name: string
): Promise<boolean> => {
	const exists = await collectionExists(client, name);
	if (!exists) return false;

	await client.deleteCollection(name);
	return true;
};

/**
 * Upsert vectors into a collection
 * Note: Collection must exist beforehand - use createCollection first
 */
export const upsertVectors = async <T extends Record<string, unknown>>(
	client: QdrantClient,
	collection: string,
	points: Point<T>[],
	options?: UpsertOptions
): Promise<void> => {
	await client.upsert(collection, {
		points,
		wait: options?.wait ?? true,
	});
};

/**
 * Delete vectors by IDs
 */
export const deleteVectors = async (
	client: QdrantClient,
	collection: string,
	ids: (string | number)[]
): Promise<void> => {
	await client.delete(collection, {
		points: ids,
		wait: true,
	});
};

/**
 * Delete vectors by filter
 */
export const deleteVectorsByFilter = async (
	client: QdrantClient,
	collection: string,
	filter: Schemas["Filter"]
): Promise<void> => {
	await client.delete(collection, {
		filter,
		wait: true,
	});
};

/**
 * Semantic search using vector similarity
 */
export const searchVectors = async (
	client: QdrantClient,
	collection: string,
	query: number[],
	options?: SearchOptions
): Promise<Schemas["ScoredPoint"][]> => {
	const {
		limit = 10,
		scoreThreshold,
		filter,
		withVector = false,
	} = options ?? {};

	const result = await client.query(collection, {
		query,
		limit,
		score_threshold: scoreThreshold,
		filter,
		with_payload: true,
		with_vector: withVector,
	});

	return result.points;
};

/**
 * Scroll through vectors with optional filtering
 */
export const scrollVectors = async (
	client: QdrantClient,
	collection: string,
	options?: ScrollOptions
): Promise<{
	points: Schemas["Record"][];
	nextOffset: Schemas["ExtendedPointId"] | null;
}> => {
	const { limit = 10, filter, offset, withVector = false } = options ?? {};

	const result = await client.scroll(collection, {
		limit,
		filter,
		offset,
		with_payload: true,
		with_vector: withVector,
	});

	return {
		points: result.points,
		nextOffset:
			(result.next_page_offset as Schemas["ExtendedPointId"] | undefined) ??
			null,
	};
};

/**
 * Full-text search on indexed text fields
 */
export const fullTextSearch = async (
	client: QdrantClient,
	collection: string,
	field: string,
	text: string,
	options?: Omit<ScrollOptions, "filter">
): Promise<Schemas["Record"][]> => {
	const { limit = 10, offset, withVector = false } = options ?? {};

	const result = await client.scroll(collection, {
		filter: {
			must: [
				{
					key: field,
					match: { text },
				},
			],
		},
		limit,
		offset,
		with_payload: true,
		with_vector: withVector,
	});

	return result.points;
};

/**
 * Hybrid search combining vector similarity with filtering
 */
export const hybridSearch = async (
	client: QdrantClient,
	collection: string,
	vector: number[],
	filter: Schemas["Filter"],
	options?: Omit<SearchOptions, "filter">
): Promise<Schemas["ScoredPoint"][]> => {
	return searchVectors(client, collection, vector, { ...options, filter });
};

/**
 * Get collection info
 */
export const getCollectionInfo = async (
	client: QdrantClient,
	name: string
): Promise<Schemas["CollectionInfo"] | null> => {
	const exists = await collectionExists(client, name);
	if (!exists) return null;

	const info = await client.getCollection(name);
	return info;
};

/**
 * Get vectors by IDs
 */
export const getVectorsByIds = async (
	client: QdrantClient,
	collection: string,
	ids: (string | number)[],
	withVector = false
): Promise<Schemas["Record"][]> => {
	const result = await client.retrieve(collection, {
		ids,
		with_payload: true,
		with_vector: withVector,
	});

	return result;
};

/**
 * Count vectors in collection (with optional filter)
 */
export const countVectors = async (
	client: QdrantClient,
	collection: string,
	filter?: Schemas["Filter"]
): Promise<number> => {
	const result = await client.count(collection, { filter, exact: true });
	return result.count;
};
