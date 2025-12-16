import { documentRouter } from "./routes/document";
import { router } from "./trpc";

export const appRouter = router({
	document: documentRouter,
});

export type AppRouter = typeof appRouter;
