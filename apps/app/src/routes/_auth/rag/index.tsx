import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/rag/")({
	beforeLoad: () => {
		throw redirect({ to: "/rag/documents" });
	},
});

