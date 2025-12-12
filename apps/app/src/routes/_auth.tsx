import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";

export const Route = createFileRoute("/_auth")({
	beforeLoad: async ({ location }) => {
		const res = await authClient.getSession();

		if (res.data && !res.error) return;

		throw redirect({
			to: "/auth/login",
			search: {
				redirect: location.href,
			},
		});
	},
});
