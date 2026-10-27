import { randomUUID } from "node:crypto";
import { db, organization, creditTransaction } from "@repo/db";
import { eq, desc, and, sql } from "@repo/db/drizzle-orm";
import { ORPCError } from "@orpc/server";
import { computeSettlement } from "../utils/cost";

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

// Credit columns are numeric(18,8)
const toNumeric = (amount: number) => amount.toFixed(8);

/** Transaction handle passed to `db.transaction` callbacks. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface CreditReservation {
	orgId: string;
	userId: string;
	amount: number;
	transactionId: string;
}

/**
 * Deduct credits from an organization.
 * By default the atomic UPDATE only succeeds while the balance covers the amount.
 * With `allowNegative` the amount is always collected (used to settle work that
 * has already been done), and the balance may go below zero.
 *
 * @returns The new balance and transaction ID, or null if insufficient funds.
 */
export async function deductCredits(input: {
	orgId: string;
	amount: number;
	description: string;
	referenceId?: string;
	userId: string;
	allowNegative?: boolean;
}): Promise<{ newBalance: number; transactionId: string } | null> {
	return db.transaction((tx) => deductCreditsIn(tx, input));
}

/** `deductCredits` inside a caller-owned transaction. */
async function deductCreditsIn(
	tx: DbTransaction,
	input: {
		orgId: string;
		amount: number;
		description: string;
		referenceId?: string;
		userId: string;
		allowNegative?: boolean;
	},
): Promise<{ newBalance: number; transactionId: string } | null> {
	const { orgId, amount, description, referenceId, userId, allowNegative } =
		input;

	if (!(amount > 0))
		throw new ORPCError("BAD_REQUEST", {
			message: "Deduction amount must be positive",
		});

	const fixed = toNumeric(amount);

	// Atomic: UPDATE ... SET balance = balance - amount [WHERE balance >= amount]
	const [updated] = await tx
		.update(organization)
		.set({
			creditsBalance: sql`${organization.creditsBalance} - ${fixed}::numeric`,
		})
		.where(
			allowNegative
				? eq(organization.id, orgId)
				: and(
						eq(organization.id, orgId),
						sql`${organization.creditsBalance} >= ${fixed}::numeric`,
					),
		)
		.returning({ creditsBalance: organization.creditsBalance });

	if (!updated) {
		// Insufficient balance (or unknown org) — nothing changed
		return null;
	}

	// Record the transaction in the same atomic unit
	const txId = randomUUID();
	await tx.insert(creditTransaction).values({
		id: txId,
		organizationId: orgId,
		type: "usage",
		amount: `-${fixed}`, // Negative for deductions
		balanceAfter: updated.creditsBalance ?? "0",
		description,
		referenceId: referenceId ?? null,
		createdBy: userId,
	});

	return { newBalance: Number(updated.creditsBalance), transactionId: txId };
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
	userId: string;
}): Promise<{ newBalance: number; transactionId: string }> {
	return db.transaction((tx) => addCreditsIn(tx, input));
}

/** `addCredits` inside a caller-owned transaction. */
async function addCreditsIn(
	tx: DbTransaction,
	input: {
		orgId: string;
		amount: number;
		type: "topup" | "refund" | "adjustment";
		description: string;
		referenceId?: string;
		userId: string;
	},
): Promise<{ newBalance: number; transactionId: string }> {
	const { orgId, amount, type, description, referenceId, userId } = input;

	if (!(amount > 0))
		throw new ORPCError("BAD_REQUEST", {
			message: "Credit amount must be positive",
		});

	const fixed = toNumeric(amount);

	const [updated] = await tx
		.update(organization)
		.set({
			creditsBalance: sql`${organization.creditsBalance} + ${fixed}::numeric`,
		})
		.where(eq(organization.id, orgId))
		.returning({ creditsBalance: organization.creditsBalance });

	if (!updated)
		throw new ORPCError("NOT_FOUND", {
			message: `Organization not found: ${orgId}`,
		});

	const txId = randomUUID();
	await tx.insert(creditTransaction).values({
		id: txId,
		organizationId: orgId,
		type,
		amount: fixed, // Positive for additions
		balanceAfter: updated.creditsBalance ?? "0",
		description,
		referenceId: referenceId ?? null,
		createdBy: userId,
	});

	return { newBalance: Number(updated.creditsBalance), transactionId: txId };
}

// ============================================================================
// Reserve then settle
// ============================================================================

/**
 * Hold `amount` credits before doing paid work.
 * Throws FORBIDDEN when the balance does not cover it.
 */
export async function reserveCredits(input: {
	orgId: string;
	userId: string;
	amount: number;
	description: string;
	referenceId?: string;
}): Promise<CreditReservation> {
	const { orgId, userId, amount, description, referenceId } = input;

	const result = await deductCredits({
		orgId,
		userId,
		amount,
		description,
		referenceId,
	});

	if (!result) {
		throw new ORPCError("FORBIDDEN", {
			message: "Insufficient credits to start this request",
		});
	}

	return { orgId, userId, amount, transactionId: result.transactionId };
}

/**
 * Turn a reservation into the real cost: refund the unused part, or collect the
 * shortfall even when that drives the balance negative. Never drops a charge.
 */
export async function settleReservation(
	reservation: CreditReservation,
	actualCost: number,
	label: string,
	referenceId?: string,
	/**
	 * Runs first inside the settlement transaction. Return false to skip the
	 * settlement (it was already done). Writing the "already settled" marker
	 * here makes marker and settlement commit or roll back together.
	 */
	beforeSettle?: (tx: DbTransaction) => Promise<boolean>,
): Promise<boolean> {
	const settlement = computeSettlement(reservation.amount, actualCost);
	const ref = referenceId ?? reservation.transactionId;

	return db.transaction(async (tx) => {
		if (beforeSettle && !(await beforeSettle(tx))) return false;

		if (settlement.kind === "refund") {
			await addCreditsIn(tx, {
				orgId: reservation.orgId,
				userId: reservation.userId,
				amount: settlement.amount,
				type: "adjustment",
				description: `${label} settlement refund`,
				referenceId: ref,
			});
		} else if (settlement.kind === "charge") {
			await deductCreditsIn(tx, {
				orgId: reservation.orgId,
				userId: reservation.userId,
				amount: settlement.amount,
				description: `${label} settlement charge`,
				referenceId: ref,
				allowNegative: true,
			});
		}
		return true;
	});
}

/**
 * Find a transaction an earlier attempt wrote for `referenceId`.
 * Lets a retried job reuse its reservation instead of reserving twice.
 */
export async function findTransactionByReference(
	orgId: string,
	referenceId: string,
): Promise<(typeof creditTransaction.$inferSelect) | null> {
	const [row] = await db
		.select()
		.from(creditTransaction)
		.where(
			and(
				eq(creditTransaction.organizationId, orgId),
				eq(creditTransaction.referenceId, referenceId),
			),
		)
		.limit(1);
	return row ?? null;
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
