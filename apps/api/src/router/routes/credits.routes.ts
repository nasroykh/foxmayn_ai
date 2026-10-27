import { z } from "zod";
import {
	orgProcedure,
	orgManagerProcedure,
	adminProcedure,
} from "../middleware";
import { env } from "../../config/env";
import { ORPCError } from "@orpc/server";
import {
	getBalance,
	getMonthlyCap,
	getMonthToDateSpend,
	setMonthlyCap,
	addCredits,
	getTransactionHistory,
} from "../../services/credits.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const creditsRoutes = {
	/**
	 * Get the current credits balance for the active organization.
	 */
	getBalance: orgProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/credits/balance`,
			description: "Get credits balance for the active organization",
		})
		.handler(async ({ context }) => {
			const [balance, monthlyCap, monthSpent] = await Promise.all([
				getBalance(context.organizationId),
				getMonthlyCap(context.organizationId),
				getMonthToDateSpend(context.organizationId),
			]);
			return {
				balance,
				monthlyCap,
				monthSpent,
				organizationId: context.organizationId,
			};
		}),

	/**
	 * Set or clear the monthly spending cap (UTC calendar month) of the active
	 * organization (organization owners and admins only, not with an API key).
	 */
	setMonthlyCap: orgManagerProcedure
		.route({
			method: "PATCH",
			path: `${PREFIX}/credits/cap`,
			description: "Set or clear the monthly spending cap (null clears it)",
		})
		.input(
			z.object({
				monthlyCap: z.number().positive().max(1_000_000).nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (context.isApiKeySession) {
				throw new ORPCError("FORBIDDEN", {
					message: "This endpoint cannot be used with an API key",
				});
			}

			const monthlyCap = await setMonthlyCap(
				context.organizationId,
				input.monthlyCap,
			);
			return { monthlyCap };
		}),

	/**
	 * Get credit transaction history for the active organization
	 * (organization owners and admins only).
	 */
	getTransactions: orgManagerProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/credits/transactions`,
			description: "Get credit transaction history",
		})
		.input(
			z.object({
				limit: z.coerce.number().min(1).max(100).optional(),
				offset: z.coerce.number().min(0).optional(),
				type: z.enum(["topup", "usage", "refund", "adjustment"]).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const transactions = await getTransactionHistory(context.organizationId, {
				limit: input.limit,
				offset: input.offset,
				type: input.type,
			});

			return { transactions };
		}),

	/**
	 * Top up credits for an organization (admin only).
	 */
	topUp: adminProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/credits/topup`,
			description: "Add credits to an organization (admin only)",
		})
		.input(
			z.object({
				organizationId: z.string().min(1),
				amount: z.number().positive().max(10000),
				description: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await addCredits({
				orgId: input.organizationId,
				amount: input.amount,
				type: "topup",
				description: input.description || `Manual top-up of $${input.amount}`,
				userId: context.user.id,
			});

			return {
				newBalance: result.newBalance,
				transactionId: result.transactionId,
				organizationId: input.organizationId,
			};
		}),
};
