import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	IconCircleCheck,
	IconCircleX,
	IconBuilding,
	IconLoader2,
} from "@tabler/icons-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth";
import { orpc } from "@/lib/orpc";
import { useAuthActions } from "@/hooks/use-auth-actions";
import { errorMessage } from "@/lib/validation";

/**
 * Invitation links are `/invite/<id>`. This route sits under `_auth`, so a
 * logged-out visitor is sent to /auth/login?redirect=/invite/<id>; login and
 * register (incl. the email OTP step) honour that redirect and bring the user
 * back here, signed in.
 */
export const Route = createFileRoute("/_auth/invite/$inviteId")({
	staticData: { title: "Invitation" },
	component: InvitePage,
});

function InviteShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-[70vh] items-center justify-center p-4">
			<Card className="w-full max-w-md">{children}</Card>
		</div>
	);
}

function InvitePage() {
	const { inviteId } = Route.useParams();
	const router = useRouter();
	const { logout, switchOrganization } = useAuthActions();
	const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [accepted, setAccepted] = useState(false);

	const invitationQuery = useQuery({
		...orpc.organization.getInvitation.queryOptions({
			input: { invitationId: inviteId },
		}),
		retry: false,
		// After accepting, the invitation is no longer pending and refetching 400s
		enabled: !accepted,
	});
	const invitation = invitationQuery.data;

	useEffect(
		() => () => {
			if (redirectTimer.current) clearTimeout(redirectTimer.current);
		},
		[],
	);

	const acceptMutation = useMutation({
		mutationFn: async () => {
			const { data, error } = await authClient.organization.acceptInvitation({
				invitationId: inviteId,
			});
			if (error || !data) {
				throw new Error(error?.message || "Failed to accept invitation");
			}
			// Use the id from the invitation, never a name match
			// Stop the invitation query before the org switch refetches everything
			setAccepted(true);
			await switchOrganization(data.invitation.organizationId);
		},
		onSuccess: () => {
			toast.success("You've joined the organization!");
			redirectTimer.current = setTimeout(() => {
				void router.navigate({ to: "/" });
			}, 1500);
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Failed to accept invitation"));
		},
	});

	const rejectMutation = useMutation(
		orpc.organization.rejectInvitation.mutationOptions({
			onSuccess: () => toast.success("Invitation declined"),
			onError: (error) =>
				toast.error(errorMessage(error, "Failed to reject invitation")),
		}),
	);

	if (acceptMutation.isSuccess) {
		return (
			<InviteShell>
				<CardHeader className="text-center">
					<div className="flex justify-center mb-4">
						<div className="rounded-full bg-primary/10 p-3">
							<IconCircleCheck className="size-8 text-primary" />
						</div>
					</div>
					<CardTitle>Welcome!</CardTitle>
					<CardDescription>
						You've successfully joined the organization. Redirecting to
						dashboard...
					</CardDescription>
				</CardHeader>
			</InviteShell>
		);
	}

	if (invitationQuery.isLoading) {
		return (
			<InviteShell>
				<CardHeader className="text-center">
					<Skeleton className="size-12 rounded-full mx-auto mb-4" />
					<Skeleton className="h-6 w-48 mx-auto mb-2" />
					<Skeleton className="h-4 w-64 mx-auto" />
				</CardHeader>
				<CardContent className="space-y-4">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</CardContent>
			</InviteShell>
		);
	}

	// Not found, expired, or addressed to a different account
	if (!invitation || invitationQuery.isError) {
		return (
			<InviteShell>
				<CardHeader className="text-center">
					<div className="flex justify-center mb-4">
						<div className="rounded-full bg-destructive/10 p-3">
							<IconCircleX className="size-8 text-destructive" />
						</div>
					</div>
					<CardTitle>Invalid Invitation</CardTitle>
					<CardDescription>
						This invitation is invalid, has expired, or was sent to a different
						email address than the account you are signed in with.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex justify-center gap-2">
					<Button variant="outline" onClick={() => router.navigate({ to: "/" })}>
						Go to dashboard
					</Button>
					<Button
						onClick={async () => {
							try {
								await logout(`/invite/${inviteId}`);
							} catch (error) {
								toast.error(errorMessage(error, "Logout failed"));
							}
						}}
					>
						Switch account
					</Button>
				</CardContent>
			</InviteShell>
		);
	}

	if (rejectMutation.isSuccess || invitation.status !== "pending") {
		return (
			<InviteShell>
				<CardHeader className="text-center">
					<div className="flex justify-center mb-4">
						<div className="rounded-full bg-muted p-3">
							<IconCircleX className="size-8 text-muted-foreground" />
						</div>
					</div>
					<CardTitle>
						{rejectMutation.isSuccess
							? "Invitation Declined"
							: "Invitation no longer available"}
					</CardTitle>
					<CardDescription>
						{rejectMutation.isSuccess
							? `You've declined the invitation to join ${invitation.organizationName}.`
							: `This invitation to ${invitation.organizationName} was already ${invitation.status}.`}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex justify-center">
					<Button variant="outline" onClick={() => router.navigate({ to: "/" })}>
						Go to dashboard
					</Button>
				</CardContent>
			</InviteShell>
		);
	}

	const isBusy = acceptMutation.isPending || rejectMutation.isPending;

	return (
		<InviteShell>
			<CardHeader className="text-center">
				<div className="flex justify-center mb-4">
					<div className="rounded-full bg-primary/10 p-3">
						<IconBuilding className="size-8 text-primary" />
					</div>
				</div>
				<CardTitle>Join {invitation.organizationName}</CardTitle>
				<CardDescription>
					{invitation.inviterEmail} invited you to join as{" "}
					<span className="font-medium">{invitation.role}</span>.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<Button onClick={() => acceptMutation.mutate()} disabled={isBusy}>
					{acceptMutation.isPending && (
						<IconLoader2 className="mr-2 size-4 animate-spin" />
					)}
					Accept invitation
				</Button>
				<Button
					variant="outline"
					onClick={() => rejectMutation.mutate({ invitationId: inviteId })}
					disabled={isBusy}
				>
					Decline
				</Button>
			</CardContent>
		</InviteShell>
	);
}
