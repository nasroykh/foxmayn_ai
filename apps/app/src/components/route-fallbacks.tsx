import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";

function FullPageMessage({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
			<h1 className="text-2xl font-semibold">{title}</h1>
			{description && (
				<p className="text-muted-foreground max-w-md text-sm break-words">
					{description}
				</p>
			)}
			<div className="flex gap-2">{children}</div>
		</div>
	);
}

export function DefaultError({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<FullPageMessage
			title="Something went wrong"
			description={error instanceof Error ? error.message : undefined}
		>
			<Button
				onClick={() => {
					reset();
					void router.invalidate();
				}}
			>
				Try again
			</Button>
			<Link to="/" className={buttonVariants({ variant: "outline" })}>
				Go to dashboard
			</Link>
		</FullPageMessage>
	);
}

export function DefaultNotFound() {
	return (
		<FullPageMessage
			title="Page not found"
			description="The page you are looking for does not exist."
		>
			<Link to="/" className={buttonVariants()}>
				Go to dashboard
			</Link>
		</FullPageMessage>
	);
}
