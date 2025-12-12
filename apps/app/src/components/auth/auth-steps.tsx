import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

interface StepWrapperProps {
	title: string;
	description: string;
	children: ReactNode;
}

export function StepWrapper({
	title,
	description,
	children,
}: StepWrapperProps) {
	return (
		<Card className="w-full max-w-sm">
			<CardHeader className="text-center">
				<CardTitle className="text-2xl">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

interface FormStepProps {
	children: ReactNode;
	onSubmit: (e: React.FormEvent) => void;
	isLoading?: boolean;
	submitText?: string;
	footerContent?: ReactNode;
}

export function FormStep({
	children,
	onSubmit,
	isLoading = false,
	submitText = "Continue",
	footerContent,
}: FormStepProps) {
	return (
		<form onSubmit={onSubmit} className="space-y-4">
			{children}
			<Button type="submit" className="w-full mt-6" disabled={isLoading}>
				{isLoading ? (
					<>
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						Loading...
					</>
				) : (
					submitText
				)}
			</Button>
			{footerContent && (
				<div className="mt-4 text-center text-sm text-muted-foreground">
					{footerContent}
				</div>
			)}
		</form>
	);
}

interface SuccessStepProps {
	email: string;
	title: string;
	message: string;
	primaryAction: {
		label: string;
		onClick: () => void;
	};
	secondaryAction?: {
		label: string;
		onClick: () => void;
	};
}

export function SuccessStep({
	email,
	title,
	message,
	primaryAction,
	secondaryAction,
}: SuccessStepProps) {
	return (
		<div className="space-y-4 text-center">
			<div className="flex justify-center">
				<div className="rounded-full bg-primary/10 p-3">
					<CheckCircle2 className="w-8 h-8 text-primary" />
				</div>
			</div>
			<div>
				<h3 className="font-semibold text-foreground text-lg">{title}</h3>
				<p className="text-muted-foreground text-sm mt-2">{message}</p>
				{email && (
					<p className="text-sm text-foreground mt-2">
						<span className="font-medium">{email}</span>
					</p>
				)}
			</div>
			<div className="flex flex-col gap-3 mt-6">
				<Button onClick={primaryAction.onClick} className="w-full">
					{primaryAction.label}
				</Button>
				{secondaryAction && (
					<Button
						onClick={secondaryAction.onClick}
						variant="outline"
						className="w-full"
					>
						{secondaryAction.label}
					</Button>
				)}
			</div>
		</div>
	);
}
