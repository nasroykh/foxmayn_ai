import { documentRoutes } from "./routes/documents.routes";
import { chatRoutes } from "./routes/chat.routes";
import { profileRoutes } from "./routes/profile.routes";

export const router = {
	documents: documentRoutes,
	chat: chatRoutes,
	profiles: profileRoutes,
};

export type AppRouter = typeof router;
