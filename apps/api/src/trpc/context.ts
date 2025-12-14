import { type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { auth } from "../utils/auth";

export async function createContext({
	req,
	res,
	info,
}: CreateFastifyContextOptions) {
	const session = await auth.api.getSession({
		headers: req?.headers,
	});

	return {
		req: {
			...req,
			headers: {
				...req?.headers,
				authorization:
					info?.connectionParams?.Authorization || req?.headers?.authorization,
			},
		},
		res,
		redis: req?.server?.redis,
		user: session?.user ?? null,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
