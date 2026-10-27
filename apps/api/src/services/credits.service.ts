import { randomUUID } from "node:crypto";
import { db, organization, creditTransaction } from "@repo/db";
import { eq, desc, and, sql, gte, inArray } from "@repo/db/drizzle-orm";
import { ORPCError } from "@orpc/server";
import { computeSettlement } from "../utils/cost";
import { startOfUtcMonth } from "../utils/month";

export { startOfUtcMonth };

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

// ============================================================================
// Monthly spending cap
// ============================================================================

/** Handle that can run a select: the shared `db` or a transaction. */
type Queryable = Pick<typeof db, "select">;

/**
 * Month-to-date spend of an organization (UTC calendar month): minus the sum of
 * `usage` and `refund` transactions, so settlement refunds give spend back.
 * Top-ups and admin adjustments do not count.
 */
export async function getMonthToDateSpend(
	orgId: string,
	tx: Queryable = db,
): Promise<number> {
	const [row] = await tx
		.select({
			spent: sql<string>`coalesce(-sum(${creditTransaction.amount}), 0)`,
		})
		.from(creditTransaction)
		.where(
			and(
				eq(creditTransaction.organizationId, orgId),
				inArray(creditTransaction.type, ["usage", "refund"]),
				gte(creditTransaction.createdAt, startOfUtcMonth(new Date())),
			),
		);

	// A refund dated this month for last month's reservation must not create room
	return Math.max(Number(row?.spent ?? 0), 0);
}

/** Monthly spending cap of an organization, or null when there is none. */
export async function getMonthlyCap(orgId: string): Promise<number | null> {
	const [org] = await db
		.select({ cap: organization.creditsMonthlyCap })
		.from(organization)
		.where(eq(organization.id, orgId));

	return org?.cap == null ? null : Number(org.cap);
}

/** Set the monthly spending cap, or clear it with null. */
export async function setMonthlyCap(
	orgId: string,
	cap: number | null,
): Promise<number | null> {
	const [updated] = await db
		.update(organization)
		.set({ creditsMonthlyCap: cap === null ? null : toNumeric(cap) })
		.where(eq(organization.id, orgId))
		.returning({ cap: organization.creditsMonthlyCap });

	if (!updated)
		throw new ORPCError("NOT_FOUND", {
			message: `Organization not found: ${orgId}`,
		});

	return updated.cap == null ? null : Number(updated.cap);
}

/**
 * Fast-fail gate for the middleware: not enough balance for `minimum`, or the
 * monthly cap is already used up. Not atomic; reserveCredits() is the hard check.
 */
export async function checkSpendGate(
	orgId: string,
	minimum: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const [org] = await db
		.select({
			balance: organization.creditsBalance,
			cap: organization.creditsMonthlyCap,
		})
		.from(organization)
		.where(eq(organization.id, orgId));

	if (Number(org?.balance ?? 0) < minimum) {
		return {
			ok: false,
			message: "Insufficient credits. Please top up your organization's balance.",
		};
	}

	if (org?.cap != null && (await getMonthToDateSpend(orgId)) >= Number(org.cap)) {
		return { ok: false, message: MONTHLY_CAP_MESSAGE };
	}

	return { ok: true };
}

// ============================================================================
// Credit Mutations (atomic)
// ============================================================================

// Credit columns are numeric(18,8)
const toNumeric = (amount: number) => amount.toFixed(8);

const MONTHLY_CAP_MESSAGE = "Monthly spending cap reached for this organization";

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
 * Throws FORBIDDEN when the balance does not cover it or the organization's
 * monthly spending cap would be exceeded.
 *
 * The organization row is locked for the transaction, so concurrent
 * reservations of one organization run one at a time and cannot overshoot the
 * cap. Settlement shortfall charges and already-paid embedding charges are not
 * capped: that work is done, same as the balance rule.
 */
export async function reserveCredits(input: {
	orgId: string;
	userId: string;
	amount: number;
	description: string;
	referenceId?: string;
}): Promise<CreditReservation> {
	const { orgId, userId, amount, description, referenceId } = input;

	const result = await db.transaction(async (tx) => {
		const [org] = await tx
			.select({ cap: organization.creditsMonthlyCap })
			.from(organization)
			.where(eq(organization.id, orgId))
			.for("update");

		if (org?.cap != null) {
			const spent = await getMonthToDateSpend(orgId, tx);
			if (spent + amount > Number(org.cap)) {
				throw new ORPCError("FORBIDDEN", { message: MONTHLY_CAP_MESSAGE });
			}
		}

		return deductCreditsIn(tx, {
			orgId,
			userId,
			amount,
			description,
			referenceId,
		});
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
				// "refund", not "adjustment": it must count against month-to-date spend
				type: "refund",
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
