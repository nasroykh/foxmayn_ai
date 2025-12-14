import {
	fastifyTRPCPlugin,
	FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { FastifyInstance } from "fastify";
import { AppRouter, appRouter } from "../trpc/router";
import { createContext } from "../trpc/context";

export const registerTRPC = async (server: FastifyInstance) => {
	await server.register(fastifyTRPCPlugin, {
		useWSS: true,
		keepAlive: {
			enabled: true,
			pingMs: 30000,
			pongWaitMs: 5000,
		},
		prefix: "/api/trpc",
		trpcOptions: {
			router: appRouter,
			createContext,
			onError({ path, error }) {
				// report to error monitoring
				console.error(`Error in tRPC handler on path '${path}':`, error);
			},
		} satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
	});
};
