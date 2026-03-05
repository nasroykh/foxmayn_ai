import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { AppRouter } from "@repo/api/orpc";

const link = new RPCLink({
	url: `${import.meta.env.VITE_API_URL}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export const orpcClient: RouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(orpcClient);
