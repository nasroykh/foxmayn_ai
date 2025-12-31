import { documentRoutes } from "./routes/documents.routes";
import { chatRoutes } from "./routes/chat.routes";
import { profileRoutes } from "./routes/profile.routes";
import { apiKeyRoutes } from "./routes/apikey.routes";
import { userRoutes } from "./routes/user.routes";

export const router = {
	documents: documentRoutes,
	chat: chatRoutes,
	profiles: profileRoutes,
	apikeys: apiKeyRoutes,
	users: userRoutes,
};

export type AppRouter = typeof router;
