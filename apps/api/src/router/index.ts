import {
	organizationRoutes,
	documentRoutes,
	chatRoutes,
	profileRoutes,
	apiKeyRoutes,
	conversationRoutes,
	healthRoutes,
	userRoutes,
} from "./routes/index.routes";

export const router = {
	health: healthRoutes,
	users: userRoutes,
	organization: organizationRoutes,
	documents: documentRoutes,
	chat: chatRoutes,
	profiles: profileRoutes,
	apikeys: apiKeyRoutes,
	conversations: conversationRoutes,
};

export type AppRouter = typeof router;
