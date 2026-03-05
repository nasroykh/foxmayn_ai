import { z } from "zod";
import { orgProcedure, adminProcedure } from "../middleware";
import { env } from "../../config/env";
import {
	getBalance,
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
			const balance = await getBalance(context.organizationId);
			return { balance, organizationId: context.organizationId };
		}),

	/**
	 * Get credit transaction history for the active organization.
	 */
	getTransactions: orgProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/credits/transactions`,
			description: "Get credit transaction history",
		})
		.input(
			z.object({
				limit: z.number().min(1).max(100).optional(),
				offset: z.number().min(0).optional(),
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
