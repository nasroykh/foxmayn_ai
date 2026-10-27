import { describeError } from "../config/redact";
import { randomUUID } from "node:crypto";
import { db, aiUsageLog } from "@repo/db";
import { eq, and, desc, sql, gte, lte } from "@repo/db/drizzle-orm";
import { ORPCError } from "@orpc/server";
import { redis } from "../config/redis";
import { calculateCost, CREDIT_EPSILON } from "../utils/cost";
import { deductCredits } from "./credits.service";

const STATS_CACHE_TTL = 30; // seconds

// ============================================================================
// Types
// ============================================================================

export interface LogUsageInput {
	organizationId: string;
	userId: string;
	operationType: "chat" | "embedding";
	model: string;
	inputTokens: number;
	outputTokens: number;
	metadata?: Record<string, unknown>;
}

export interface UsageStatsResult {
	totalCost: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCalls: number;
	byModel: Array<{
		model: string;
		totalCost: number;
		totalCalls: number;
	}>;
	byOperation: Array<{
		operationType: string;
		totalCost: number;
		totalCalls: number;
	}>;
}

// ============================================================================
// Usage log
// ============================================================================

const statsVersionKey = (orgId: string) => `usage_stats_ver:${orgId}`;

/**
 * Invalidate cached stats for an org by bumping its version counter
 * (part of every stats cache key). Best-effort: a Redis failure must never
 * fail a request that was already billed.
 */
export async function invalidateUsageStats(orgId: string): Promise<void> {
	await redis
		.incr(statsVersionKey(orgId))
		.catch((err) =>
			console.error("[Usage] Failed to invalidate usage stats cache:", describeError(err)),
		);
}

/**
 * Insert an ai_usage_log row for a call whose credits were already settled.
 * Best-effort: the credit transaction is the source of truth for billing.
 */
export async function recordUsage(input: {
	id?: string;
	organizationId: string;
	userId: string;
	operationType: "chat" | "embedding";
	model: string;
	inputTokens: number;
	outputTokens: number;
	costCredits: number;
	metadata?: Record<string, unknown>;
}): Promise<void> {
	await db
		.insert(aiUsageLog)
		.values({
			id: input.id ?? randomUUID(),
			organizationId: input.organizationId,
			userId: input.userId,
			operationType: input.operationType,
			model: input.model,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
			totalTokens: input.inputTokens + input.outputTokens,
			costCredits: input.costCredits.toFixed(8),
			metadata: input.metadata ?? {},
		})
		.onConflictDoNothing()
		.catch((err) =>
			console.error("[Usage] Failed to insert usage log:", describeError(err)),
		);

	await invalidateUsageStats(input.organizationId);
}

// ============================================================================
// Log AI Usage & Deduct Credits
// ============================================================================

/**
 * Log a finished AI API call and collect its cost from the organization.
 *
 * Used for small calls that are billed after the fact (query embeddings).
 * The work is already done, so the cost is always collected, even when that
 * drives the balance slightly negative — it is never dropped.
 *
 * @returns The usage log entry and deduction result
 */
export async function logUsageAndDeduct(input: LogUsageInput): Promise<{
	usageId: string;
	costCredits: number;
	newBalance: number;
	transactionId: string;
}> {
	const {
		organizationId,
		userId,
		operationType,
		model,
		inputTokens,
		outputTokens,
		metadata,
	} = input;

	const totalTokens = inputTokens + outputTokens;
	const costCredits = calculateCost(model, inputTokens, outputTokens);

	// Pre-generate so deductCredits can reference it as referenceId
	const usageId = randomUUID();

	let newBalance = 0;
	let transactionId = "";

	// Costs below the column precision round to zero: nothing to collect
	if (costCredits >= CREDIT_EPSILON) {
		const deductionResult = await deductCredits({
			orgId: organizationId,
			amount: costCredits,
			description: `${operationType} — ${model} (${totalTokens} tokens)`,
			referenceId: usageId,
			userId,
			allowNegative: true,
		});

		if (!deductionResult) {
			throw new ORPCError("NOT_FOUND", {
				message: `Organization not found: ${organizationId}`,
			});
		}

		newBalance = deductionResult.newBalance;
		transactionId = deductionResult.transactionId;
	}

	await recordUsage({
		id: usageId,
		organizationId,
		userId,
		operationType,
		model,
		inputTokens,
		outputTokens,
		costCredits,
		metadata,
	});

	return {
		usageId,
		costCredits,
		newBalance,
		transactionId,
	};
}

// ============================================================================
// Usage Stats & History
// ============================================================================

/**
 * Get aggregated usage stats for an organization within a date range.
 * Results are cached in Redis for 30 seconds.
 */
export async function getUsageStats(
	orgId: string,
	options: { from?: Date; to?: Date } = {},
): Promise<UsageStatsResult> {
	// Cache is best-effort: a Redis failure falls through to the database
	let cacheKey: string | null = null;
	try {
		const version = (await redis.get(statsVersionKey(orgId))) ?? "0";
		cacheKey = `usage_stats:${orgId}:v${version}:${options.from?.toISOString() ?? "all"}:${options.to?.toISOString() ?? "all"}`;
		const cached = await redis.get(cacheKey);
		if (cached) return JSON.parse(cached) as UsageStatsResult;
	} catch (err) {
		console.error("[Usage] Stats cache read failed:", describeError(err));
	}

	const conditions = [eq(aiUsageLog.organizationId, orgId)];
	if (options.from) conditions.push(gte(aiUsageLog.createdAt, options.from));
	if (options.to) conditions.push(lte(aiUsageLog.createdAt, options.to));

	const whereClause = and(...conditions);

	// Single query grouped by model + operation_type; derive all breakdowns in JS
	const rows = await db
		.select({
			model: aiUsageLog.model,
			operationType: aiUsageLog.operationType,
			totalCost: sql<string>`coalesce(sum(${aiUsageLog.costCredits}), 0)`,
			totalInputTokens: sql<string>`coalesce(sum(${aiUsageLog.inputTokens}), 0)`,
			totalOutputTokens: sql<string>`coalesce(sum(${aiUsageLog.outputTokens}), 0)`,
			totalCalls: sql<string>`count(*)`,
		})
		.from(aiUsageLog)
		.where(whereClause)
		.groupBy(aiUsageLog.model, aiUsageLog.operationType);

	// Aggregate totals and breakdowns from the single result set
	let totalCost = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCalls = 0;
	const byModelMap = new Map<string, { totalCost: number; totalCalls: number }>();
	const byOperationMap = new Map<string, { totalCost: number; totalCalls: number }>();

	for (const row of rows) {
		const cost = Number(row.totalCost);
		const calls = Number(row.totalCalls);
		totalCost += cost;
		totalInputTokens += Number(row.totalInputTokens);
		totalOutputTokens += Number(row.totalOutputTokens);
		totalCalls += calls;

		const existing = byModelMap.get(row.model);
		byModelMap.set(row.model, {
			totalCost: (existing?.totalCost ?? 0) + cost,
			totalCalls: (existing?.totalCalls ?? 0) + calls,
		});

		const existingOp = byOperationMap.get(row.operationType);
		byOperationMap.set(row.operationType, {
			totalCost: (existingOp?.totalCost ?? 0) + cost,
			totalCalls: (existingOp?.totalCalls ?? 0) + calls,
		});
	}

	const result: UsageStatsResult = {
		totalCost,
		totalInputTokens,
		totalOutputTokens,
		totalCalls,
		byModel: Array.from(byModelMap.entries()).map(([model, v]) => ({ model, ...v })),
		byOperation: Array.from(byOperationMap.entries()).map(([operationType, v]) => ({
			operationType,
			...v,
		})),
	};

	if (cacheKey) {
		await redis
			.setex(cacheKey, STATS_CACHE_TTL, JSON.stringify(result))
			.catch((err) => console.error("[Usage] Stats cache write failed:", describeError(err)));
	}
	return result;
}

/**
 * Get paginated usage history for an organization.
 */
export async function getUsageHistory(
	orgId: string,
	options: {
		limit?: number;
		offset?: number;
		operationType?: "chat" | "embedding";
		userId?: string;
	} = {},
) {
	const { limit = 20, offset = 0, operationType, userId } = options;

	const conditions = [eq(aiUsageLog.organizationId, orgId)];
	if (operationType) {
		conditions.push(eq(aiUsageLog.operationType, operationType));
	}
	if (userId) {
		conditions.push(eq(aiUsageLog.userId, userId));
	}

	return db
		.select()
		.from(aiUsageLog)
		.where(and(...conditions))
		.orderBy(desc(aiUsageLog.createdAt))
		.limit(limit)
		.offset(offset);
}
