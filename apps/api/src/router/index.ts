import { documentRoutes } from "./routes/documents.routes";
import { chatRoutes } from "./routes/chat.routes";

export const router = {
	documents: documentRoutes,
	chat: chatRoutes,
};

export type AppRouter = typeof router;
