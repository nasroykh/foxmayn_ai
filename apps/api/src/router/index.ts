import { documentRoutes } from "./routes/document.routes";
import { chatRoutes } from "./routes/chat.routes";
import { profileRoutes } from "./routes/profile.routes";
import { apiKeyRoutes } from "./routes/apikey.routes";
import { userRoutes } from "./routes/user.routes";
import { conversationRoutes } from "./routes/conversation.routes";

export const router = {
	documents: documentRoutes,
	chat: chatRoutes,
	profiles: profileRoutes,
	apikeys: apiKeyRoutes,
	users: userRoutes,
	conversations: conversationRoutes,
};

export type AppRouter = typeof router;
