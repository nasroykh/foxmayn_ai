import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { AppRouter } from "api/orpc";
import { QueryClient } from "@tanstack/react-query";

const link = new RPCLink({
	url: import.meta.env.VITE_IS_DEV
		? `${import.meta.env.VITE_API_URL_DEV}/rpc`
		: `${import.meta.env.VITE_API_URL}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

const orpcClient: RouterClient<AppRouter> = createORPCClient(link);

export const queryClient = new QueryClient();

export const orpc = createTanstackQueryUtils(orpcClient);
