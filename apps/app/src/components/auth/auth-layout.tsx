import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface AuthLayoutProps {
	children: ReactNode;
	totalSteps: number;
	currentStep: number;
	onBack?: () => void;
	showBackButton?: boolean;
}

export function AuthLayout({
	children,
	totalSteps,
	currentStep,
	onBack,
	showBackButton = false,
}: AuthLayoutProps) {
	return (
		<div
			className={`relative min-h-screen flex flex-col items-center justify-center px-4 transition-colors duration-300`}
		>
			{/* Back Button */}
			{showBackButton && onBack && (
				<button
					onClick={onBack}
					className="absolute top-6 left-6 p-2.5 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-2"
					aria-label="Go back"
				>
					<ArrowLeft className="w-5 h-5" />
				</button>
			)}

			{/* Step Indicator */}
			<div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-2">
				{Array.from({ length: totalSteps }).map((_, index) => (
					<div
						key={index}
						className={`w-2 h-2 rounded-full transition-colors ${
							index < currentStep ? "bg-primary" : "bg-muted"
						}`}
					/>
				))}
			</div>

			{children}

			{/* Decorative Element */}
			<div className="absolute inset-0 -z-10 bg-linear-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
		</div>
	);
}
