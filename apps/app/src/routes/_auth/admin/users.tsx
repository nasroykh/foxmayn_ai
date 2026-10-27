import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminUsersPage } from "@/components/admin/users-page";
import { hasAdminRole } from "@/lib/roles";

export const Route = createFileRoute("/_auth/admin/users")({
	staticData: { title: "Users" },
	beforeLoad: async ({ context }) => {
		if (!hasAdminRole(context.session?.user?.role)) {
			throw redirect({ to: "/" });
		}
	},
	component: AdminUsersPage,
});
