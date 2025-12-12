import { subscriptionRouter } from "./routes/subscription";
import { router } from "./trpc";

export const appRouter = router({
	subscription: subscriptionRouter,
});

export type AppRouter = typeof appRouter;
