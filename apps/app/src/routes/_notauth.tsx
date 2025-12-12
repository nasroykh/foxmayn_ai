import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";

export const Route = createFileRoute("/_notauth")({
	beforeLoad: async () => {
		const res = await authClient.getSession();
		if (!res.data || res.error) return;

		throw redirect({
			to: "/",
		});
	},
});
