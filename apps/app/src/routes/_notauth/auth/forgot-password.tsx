import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
	AuthLayout,
	StepWrapper,
	FormStep,
	SuccessStep,
	OtpStep,
} from "@/components/auth";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth";
import { errorMessage, newPasswordSchema } from "@/lib/validation";
import { toast } from "sonner";

export const Route = createFileRoute("/_notauth/auth/forgot-password")({
	component: RouteComponent,
});

// Form validation schemas
const emailSchema = z.object({
	email: z.email("Invalid email address"),
});

const resetPasswordSchema = z
	.object({
		password: newPasswordSchema,
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords don't match",
		path: ["confirmPassword"],
	});

type EmailFormValues = z.infer<typeof emailSchema>;
type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

function RouteComponent() {
	const navigate = useNavigate();
	const [currentStep, setCurrentStep] = useState(1);
	const [userEmail, setUserEmail] = useState("");
	const [otp, setOtp] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	const emailForm = useForm<EmailFormValues>({
		resolver: zodResolver(emailSchema),
		defaultValues: { email: "" },
	});

	const resetPasswordForm = useForm<ResetPasswordFormValues>({
		resolver: zodResolver(resetPasswordSchema),
		defaultValues: { password: "", confirmPassword: "" },
	});

	const onEmailSubmit = async (values: EmailFormValues) => {
		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.sendVerificationOtp({
				email: values.email,
				type: "forget-password",
			});

			if (error) {
				toast.error(error.message || "Failed to send reset email");
				return;
			}

			toast.success("Reset email sent");
			setUserEmail(values.email);
			setCurrentStep(2);
		} catch (err) {
			toast.error(errorMessage(err, "An unexpected error occurred"));
		} finally {
			setIsLoading(false);
		}
	};

	const onVerificationSubmit = async (code: string) => {
		// Check the code now so a typo is caught before the user picks a password
		const { data, error } = await authClient.emailOtp.checkVerificationOtp({
			email: userEmail,
			type: "forget-password",
			otp: code,
		});
		if (error || !data?.success) {
			throw new Error(error?.message || "Invalid or expired code");
		}
		setOtp(code);
		setCurrentStep(3);
	};

	const onResetPasswordSubmit = async (values: ResetPasswordFormValues) => {
		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.resetPassword({
				email: userEmail,
				otp,
				password: values.password,
			});

			if (error) {
				toast.error(error.message || "Password reset failed");
				return;
			}

			toast.success("Password reset successful");
			setCurrentStep(4);
		} catch (err) {
			toast.error(errorMessage(err, "Password reset failed"));
		} finally {
			setIsLoading(false);
		}
	};

	const resendCode = async () => {
		const { error } = await authClient.emailOtp.sendVerificationOtp({
			email: userEmail,
			type: "forget-password",
		});
		if (error) throw new Error(error.message || "Failed to resend code");
	};

	const handleReset = () => {
		setCurrentStep(1);
		emailForm.reset();
		resetPasswordForm.reset();
		setUserEmail("");
		setOtp("");
	};

	return (
		<AuthLayout
			totalSteps={4}
			currentStep={currentStep}
			onBack={() => setCurrentStep(currentStep - 1)}
			showBackButton={currentStep !== 1 && currentStep !== 4}
		>
			{currentStep === 1 && (
				<StepWrapper
					title="Reset password"
					description="We'll email you a code to reset your password"
				>
					<Form {...emailForm}>
						<FormStep
							onSubmit={emailForm.handleSubmit(onEmailSubmit)}
							isLoading={isLoading}
							submitText="Send reset code"
							footerContent={
								<>
									Remember your password?{" "}
									<Link
										to="/auth/login"
										className="text-primary hover:underline font-medium"
									>
										Back to login
									</Link>
								</>
							}
						>
							<FormField
								control={emailForm.control}
								name="email"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Email</FormLabel>
										<FormControl>
											<Input
												placeholder="name@example.com"
												type="email"
												autoComplete="email"
												{...field}
												disabled={isLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</FormStep>
					</Form>
				</StepWrapper>
			)}

			{currentStep === 2 && (
				<OtpStep
					email={userEmail}
					title="Verify email"
					submitText="Verify code"
					onSubmit={onVerificationSubmit}
					onResend={resendCode}
				/>
			)}

			{currentStep === 3 && (
				<StepWrapper
					title="Set new password"
					description="Create a strong password for your account"
				>
					<Form {...resetPasswordForm}>
						<FormStep
							onSubmit={resetPasswordForm.handleSubmit(onResetPasswordSubmit)}
							isLoading={isLoading}
							submitText="Reset password"
						>
							<FormField
								control={resetPasswordForm.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>New Password</FormLabel>
										<FormControl>
											<Input
												placeholder="Enter new password"
												type="password"
												autoComplete="new-password"
												{...field}
												disabled={isLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={resetPasswordForm.control}
								name="confirmPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Confirm Password</FormLabel>
										<FormControl>
											<Input
												placeholder="Confirm new password"
												type="password"
												autoComplete="new-password"
												{...field}
												disabled={isLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</FormStep>
					</Form>
				</StepWrapper>
			)}

			{currentStep === 4 && (
				<StepWrapper
					title="Password reset!"
					description="Your password has been successfully reset"
				>
					<SuccessStep
						email={userEmail}
						title="Password reset!"
						message="Your password has been updated. You can now log in with your new password."
						primaryAction={{
							label: "Go to login",
							onClick: () => navigate({ to: "/auth/login" }),
						}}
						secondaryAction={{
							label: "Reset another account",
							onClick: handleReset,
						}}
					/>
				</StepWrapper>
			)}
		</AuthLayout>
	);
}
