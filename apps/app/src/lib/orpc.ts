import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils, type RouterUtils } from "@orpc/tanstack-query";

import type { AppRouter } from "api/orpc";

const link = new RPCLink({
	url:
		import.meta.env.VITE_IS_DEV === "true"
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

export const orpc: RouterUtils<RouterClient<AppRouter>> = createTanstackQueryUtils(orpcClient);
