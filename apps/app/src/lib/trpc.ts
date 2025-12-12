import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { type AppRouter } from "api/trpc";
import { QueryClient } from "@tanstack/react-query";
import {
	createTRPCClient,
	httpBatchLink,
	httpSubscriptionLink,
	splitLink,
} from "@trpc/client";
import SuperJSON from "superjson";

export const queryClient = new QueryClient();

const trpcClient = createTRPCClient<AppRouter>({
	links: [
		splitLink({
			condition(op) {
				return op.type === "subscription";
			},
			true: httpSubscriptionLink({
				url: import.meta.env.VITE_IS_DEV
					? `${import.meta.env.VITE_API_URL_DEV}/trpc`
					: `${import.meta.env.VITE_API_URL}/trpc`,
				transformer: SuperJSON,
				eventSourceOptions() {
					return {
						withCredentials: true,
					};
				},
			}),
			false: httpBatchLink({
				url: import.meta.env.VITE_IS_DEV
					? `${import.meta.env.VITE_API_URL_DEV}/trpc`
					: `${import.meta.env.VITE_API_URL}/trpc`,
				transformer: SuperJSON,
				fetch(url, options) {
					return fetch(url, {
						...options,
						credentials: "include",
					});
				},
			}),
		}),
	],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
	client: trpcClient,
	queryClient,
});
