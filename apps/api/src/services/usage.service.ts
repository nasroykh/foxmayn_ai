import { randomUUID } from "node:crypto";
import { db, aiUsageLog } from "@repo/db";
import { eq, and, desc, sql, gte, lte } from "@repo/db/drizzle-orm";
import { calculateCost } from "../utils/cost";
import { deductCredits } from "./credits.service";

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
 * 2. Inserts a row into ai_usage_log
 * 3. Deducts credits atomically
 *
 * @returns The usage log entry and deduction result
 */
export async function logUsageAndDeduct(input: LogUsageInput): Promise<{
	usageId: string;
	costCredits: number;
	deductionResult: { newBalance: number; transactionId: string } | null;
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

	// 1. Insert usage log
	const usageId = randomUUID();
	await db.insert(aiUsageLog).values({
		id: usageId,
		organizationId,
		userId,
		operationType,
		model,
		inputTokens,
		outputTokens,
		totalTokens,
		costCredits,
		metadata: metadata ?? {},
	});

	// 2. Deduct credits (will return null if insufficient — but we already
	//    did a pre-check, so this is a safety net)
	const deductionResult = await deductCredits({
		orgId: organizationId,
		amount: costCredits,
		description: `${operationType} — ${model} (${totalTokens} tokens)`,
		referenceId: usageId,
		userId,
	});

	return { usageId, costCredits, deductionResult };
}

// ============================================================================
// Usage Stats & History
// ============================================================================

/**
 * Get aggregated usage stats for an organization within a date range.
 */
export async function getUsageStats(
	orgId: string,
	options: { from?: Date; to?: Date } = {},
): Promise<UsageStatsResult> {
	const conditions = [eq(aiUsageLog.organizationId, orgId)];
	if (options.from) conditions.push(gte(aiUsageLog.createdAt, options.from));
	if (options.to) conditions.push(lte(aiUsageLog.createdAt, options.to));

	const whereClause = and(...conditions);

	// Totals
	const [totals] = await db
		.select({
			totalCost: sql<number>`coalesce(sum(${aiUsageLog.costCredits}), 0)`,
			totalInputTokens: sql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)`,
			totalOutputTokens: sql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)`,
			totalCalls: sql<number>`count(*)`,
		})
		.from(aiUsageLog)
		.where(whereClause);

	// By model
	const byModel = await db
		.select({
			model: aiUsageLog.model,
			totalCost: sql<number>`coalesce(sum(${aiUsageLog.costCredits}), 0)`,
			totalCalls: sql<number>`count(*)`,
		})
		.from(aiUsageLog)
		.where(whereClause)
		.groupBy(aiUsageLog.model);

	// By operation type
	const byOperation = await db
		.select({
			operationType: aiUsageLog.operationType,
			totalCost: sql<number>`coalesce(sum(${aiUsageLog.costCredits}), 0)`,
			totalCalls: sql<number>`count(*)`,
		})
		.from(aiUsageLog)
		.where(whereClause)
		.groupBy(aiUsageLog.operationType);

	return {
		totalCost: Number(totals?.totalCost ?? 0),
		totalInputTokens: Number(totals?.totalInputTokens ?? 0),
		totalOutputTokens: Number(totals?.totalOutputTokens ?? 0),
		totalCalls: Number(totals?.totalCalls ?? 0),
		byModel: byModel.map((r) => ({
			model: r.model,
			totalCost: Number(r.totalCost),
			totalCalls: Number(r.totalCalls),
		})),
		byOperation: byOperation.map((r) => ({
			operationType: r.operationType,
			totalCost: Number(r.totalCost),
			totalCalls: Number(r.totalCalls),
		})),
	};
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
