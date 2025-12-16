import { authProcedure, router } from "../trpc";

export const documentRouter = router({
	createDocument: authProcedure.mutation(async ({ ctx }) => {
		const { user } = ctx;

		return {
			message: `Document created for user ${user.id}`,
		};
	}),
});
