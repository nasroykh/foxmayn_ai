import { authProcedure, router } from "../trpc";

export const subscriptionRouter = router({
	subscribe: authProcedure.mutation(async ({ ctx }) => {
		const { user } = ctx;

		return {
			message: `Subscription created for user ${user.id}`,
		};
	}),
});
