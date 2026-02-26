import { userRoutes } from "./routes/user.routes";
import { organizationRoutes } from "./routes/organization.routes";
import { healthRoutes } from "./routes/health.routes";
import { documentRoutes } from "./routes/document.routes";
import { chatRoutes } from "./routes/chat.routes";
import { profileRoutes } from "./routes/profile.routes";
import { apiKeyRoutes } from "./routes/apikey.routes";
import { conversationRoutes } from "./routes/conversation.routes";
import { creditsRoutes } from "./routes/credits.routes";
import { usageRoutes } from "./routes/usage.routes";

export const router = {
	health: healthRoutes,
	users: userRoutes,
	organization: organizationRoutes,
	documents: documentRoutes,
	chat: chatRoutes,
	profiles: profileRoutes,
	apikeys: apiKeyRoutes,
	conversations: conversationRoutes,
	credits: creditsRoutes,
	usage: usageRoutes,
};

export type AppRouter = typeof router;
