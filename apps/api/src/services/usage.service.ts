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

	// 1. Deduct credits first (atomic). Returns null if balance is insufficient.
	const deductionResult = await deductCredits({
		orgId: organizationId,
		amount: costCredits,
		description: `${operationType} — ${model} (${totalTokens} tokens)`,
		referenceId: usageId,
		userId,
	});

	if (!deductionResult) {
		throw new Error(
			`Insufficient credits: ${operationType} on ${model} costs $${costCredits.toFixed(6)} but organization ${organizationId} has an insufficient balance`,
		);
	}

	// 2. Insert usage log after successful deduction.
	//    If this fails, credits were still deducted — log the error but don't re-throw.
	await db
		.insert(aiUsageLog)
		.values({
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
		})
		.catch((err) => {
			console.error(
				`[Usage] Failed to insert usage log ${usageId} after successful deduction — credits were still charged:`,
				err,
			);
		});

	return {
		usageId,
		costCredits,
		newBalance: deductionResult.newBalance,
		transactionId: deductionResult.transactionId,
	};
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
