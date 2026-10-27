import { createFileRoute, redirect } from "@tanstack/react-router";
import { safeRedirect } from "@/lib/safe-redirect";

export const Route = createFileRoute("/_notauth")({
	beforeLoad: async ({ context, location }) => {
		if (!context.session) return;

		const target = safeRedirect(
			(location.search as Record<string, unknown>).redirect,
		);
		if (target) throw redirect({ href: target });
		throw redirect({ to: "/" });
	},
});
