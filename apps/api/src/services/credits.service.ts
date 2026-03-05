import { randomUUID } from "node:crypto";
import { db, organization, creditTransaction } from "@repo/db";
import { eq, desc, and, sql } from "@repo/db/drizzle-orm";

// ============================================================================
// Balance Operations
// ============================================================================

/**
 * Get the current credits balance for an organization.
 */
export async function getBalance(orgId: string): Promise<number> {
	const [org] = await db
		.select({ creditsBalance: organization.creditsBalance })
		.from(organization)
		.where(eq(organization.id, orgId));

	return Number(org?.creditsBalance ?? 0);
}

/**
 * Check if an organization has enough credits for an estimated cost.
 */
export async function hasEnoughCredits(
	orgId: string,
	estimatedCost: number,
): Promise<boolean> {
	const balance = await getBalance(orgId);
	return balance >= estimatedCost;
}

// ============================================================================
// Credit Mutations (atomic)
// ============================================================================

/**
 * Deduct credits from an organization.
 * Uses an atomic SQL UPDATE with a balance check to prevent negative balances.
 *
 * @returns The new balance and transaction ID, or null if insufficient funds.
 */
export async function deductCredits(input: {
	orgId: string;
	amount: number;
	description: string;
	referenceId?: string;
	userId?: string;
}): Promise<{ newBalance: number; transactionId: string } | null> {
	const { orgId, amount, description, referenceId, userId } = input;

	if (amount <= 0) throw new Error("Deduction amount must be positive");

	return db.transaction(async (tx) => {
		// Atomic: UPDATE ... SET balance = balance - amount WHERE balance >= amount
		const [updated] = await tx
			.update(organization)
			.set({
				creditsBalance: sql`${organization.creditsBalance} - ${amount}`,
			})
			.where(
				and(
					eq(organization.id, orgId),
					sql`${organization.creditsBalance} >= ${amount}`,
				),
			)
			.returning({ creditsBalance: organization.creditsBalance });

		if (!updated) {
			// Insufficient balance — return null without rolling back (nothing changed)
			return null;
		}

		// Record the transaction in the same atomic unit
		const txId = randomUUID();
		await tx.insert(creditTransaction).values({
			id: txId,
			organizationId: orgId,
			type: "usage",
			amount: (-amount).toString(), // Negative for deductions
			balanceAfter: updated.creditsBalance ?? "0",
			description,
			referenceId: referenceId ?? null,
			createdBy: userId ?? null,
		});

		return { newBalance: Number(updated.creditsBalance), transactionId: txId };
	});
}

/**
 * Add credits to an organization (top-up, refund, or adjustment).
 */
export async function addCredits(input: {
	orgId: string;
	amount: number;
	type: "topup" | "refund" | "adjustment";
	description: string;
	referenceId?: string;
	userId?: string;
}): Promise<{ newBalance: number; transactionId: string }> {
	const { orgId, amount, type, description, referenceId, userId } = input;

	if (amount <= 0) throw new Error("Credit amount must be positive");

	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(organization)
			.set({
				creditsBalance: sql`${organization.creditsBalance} + ${amount}`,
			})
			.where(eq(organization.id, orgId))
			.returning({ creditsBalance: organization.creditsBalance });

		if (!updated) throw new Error(`Organization not found: ${orgId}`);

		const txId = randomUUID();
		await tx.insert(creditTransaction).values({
			id: txId,
			organizationId: orgId,
			type,
			amount: amount.toString(), // Positive for additions
			balanceAfter: updated.creditsBalance ?? "0",
			description,
			referenceId: referenceId ?? null,
			createdBy: userId ?? null,
		});

		return { newBalance: Number(updated.creditsBalance), transactionId: txId };
	});
}

// ============================================================================
// Transaction History
// ============================================================================

/**
 * Get paginated credit transaction history for an organization.
 */
export async function getTransactionHistory(
	orgId: string,
	options: {
		limit?: number;
		offset?: number;
		type?: "topup" | "usage" | "refund" | "adjustment";
	} = {},
): Promise<(typeof creditTransaction.$inferSelect)[]> {
	const { limit = 20, offset = 0, type } = options;

	const conditions = [eq(creditTransaction.organizationId, orgId)];
	if (type) {
		conditions.push(eq(creditTransaction.type, type));
	}

	return db
		.select()
		.from(creditTransaction)
		.where(and(...conditions))
		.orderBy(desc(creditTransaction.createdAt))
		.limit(limit)
		.offset(offset);
}
