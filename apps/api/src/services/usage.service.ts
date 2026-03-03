import { randomUUID } from "node:crypto";
import { db, aiUsageLog } from "@repo/db";
import { eq, and, desc, sql, gte, lte } from "@repo/db/drizzle-orm";
import { ORPCError } from "@orpc/server";
import Redis from "ioredis";
import { env } from "../config/env";
import { calculateCost } from "../utils/cost";
import { deductCredits } from "./credits.service";

const redis = new Redis(env.REDIS_URL);
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
// Log AI Usage & Deduct Credits
// ============================================================================

/**
 * Log an AI API call and deduct credits from the organization.
 *
 * This is the single entry point for recording usage — it:
 * 1. Calculates the cost based on model pricing
 * 2. Deducts credits atomically — throws if insufficient balance
 * 3. Inserts a row into ai_usage_log (best-effort; deduction already committed)
 *
 * @throws If the organization has insufficient credits to cover the cost
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

	if (costCredits > 0) {
		// Deduct credits atomically.
		const deductionResult = await deductCredits({
			orgId: organizationId,
			amount: costCredits,
			description: `${operationType} — ${model} (${totalTokens} tokens)`,
			referenceId: usageId,
			userId,
		});

		if (!deductionResult) {
			throw new ORPCError("FORBIDDEN", {
				message: `Insufficient credits: ${operationType} on ${model} costs $${costCredits.toFixed(6)} but organization ${organizationId} has an insufficient balance`,
			});
		}

		newBalance = deductionResult.newBalance;
		transactionId = deductionResult.transactionId;
	}

	// Insert usage log. If this fails, throw so callers know something went wrong.
	await db.insert(aiUsageLog).values({
		id: usageId,
		organizationId,
		userId,
		operationType,
		model,
		inputTokens,
		outputTokens,
		totalTokens,
		costCredits: costCredits.toString(),
		metadata: metadata ?? {},
	});

	// Invalidate cached stats for this org
	const pattern = `usage_stats:${organizationId}:*`;
	const keys = await redis.keys(pattern);
	if (keys.length > 0) await redis.del(...keys);

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
	const cacheKey = `usage_stats:${orgId}:${options.from?.toISOString() ?? "all"}:${options.to?.toISOString() ?? "all"}`;
	const cached = await redis.get(cacheKey);
	if (cached) return JSON.parse(cached) as UsageStatsResult;

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

	await redis.setex(cacheKey, STATS_CACHE_TTL, JSON.stringify(result));
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
