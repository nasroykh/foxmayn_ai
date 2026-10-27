import { createFileRoute, redirect } from "@tanstack/react-router";
import { Layout } from "@/components/layout/layout";

export const Route = createFileRoute("/_auth")({
	beforeLoad: async ({ context, location }) => {
		if (context.session) return;

		throw redirect({
			to: "/auth/login",
			search: {
				redirect: location.href,
			},
		});
	},
	component: Layout,
});
