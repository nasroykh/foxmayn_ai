import { z } from "zod";
import { orgProcedure } from "../middleware";
import { env } from "../../config/env";
import { getUsageStats, getUsageHistory } from "../../services/usage.service";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

export const usageRoutes = {
	/**
	 * Get aggregated usage statistics for the active organization.
	 */
	getStats: orgProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/usage/stats`,
			description:
				"Get aggregated AI usage stats (total cost, by model, by operation type)",
		})
		.input(
			z.object({
				from: z.coerce.date().optional(),
				to: z.coerce.date().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const stats = await getUsageStats(context.organizationId, {
				from: input.from,
				to: input.to,
			});

			return stats;
		}),

	/**
	 * Get paginated AI usage history for the active organization.
	 */
	getHistory: orgProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/usage/history`,
			description: "Get paginated AI usage log",
		})
		.input(
			z.object({
				limit: z.number().min(1).max(100).optional(),
				offset: z.number().min(0).optional(),
				operationType: z.enum(["chat", "embedding"]).optional(),
				userId: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const history = await getUsageHistory(context.organizationId, {
				limit: input.limit,
				offset: input.offset,
				operationType: input.operationType,
				userId: input.userId,
			});

			return { history };
		}),
};
