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
import { toast } from "sonner";

export const Route = createFileRoute("/_notauth/auth/forgot-password")({
	component: RouteComponent,
});

// Form validation schemas
const emailSchema = z.object({
	email: z.email("Invalid email address"),
});

const verificationSchema = z.object({
	code: z.string().length(6, "Verification code must be 6 digits"),
});

const resetPasswordSchema = z
	.object({
		password: z.string().min(8, "Password must be at least 8 characters"),
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords don't match",
		path: ["confirmPassword"],
	});

type EmailFormValues = z.infer<typeof emailSchema>;
type VerificationFormValues = z.infer<typeof verificationSchema>;
type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

function RouteComponent() {
	const navigate = useNavigate();
	const [currentStep, setCurrentStep] = useState(1);
	const [userEmail, setUserEmail] = useState("");
	const [otp, setOtp] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isResending, setIsResending] = useState(false);

	const emailForm = useForm<EmailFormValues>({
		resolver: zodResolver(emailSchema),
		defaultValues: { email: "" },
	});

	const verificationForm = useForm<VerificationFormValues>({
		resolver: zodResolver(verificationSchema),
		defaultValues: { code: "" },
	});

	const resetPasswordForm = useForm<ResetPasswordFormValues>({
		resolver: zodResolver(resetPasswordSchema),
		defaultValues: { password: "", confirmPassword: "" },
	});

	const onEmailSubmit = async (data: EmailFormValues) => {
		setIsLoading(true);

		try {
			const res = await authClient.forgetPassword.emailOtp({
				email: data.email,
			});

			if (!res.data || res.error) {
				toast.error(
					(res.error && res.error.message) || "Failed to send reset email"
				);
				return;
			}

			toast.success("Reset email sent");
			setUserEmail(data.email);
			setCurrentStep(2);
		} catch (error) {
			console.error("Failed to send reset email:", error);
			toast.error("Failed to send reset email");
		} finally {
			setIsLoading(false);
		}
	};

	const onVerificationSubmit = async (data: VerificationFormValues) => {
		setIsLoading(true);

		try {
			const res = await authClient.emailOtp.checkVerificationOtp({
				email: userEmail,
				otp: data.code,
				type: "forget-password",
			});

			if (!res.data || res.error) {
				toast.error(
					(res.error && res.error.message) || "Invalid verification code"
				);
				return;
			}

			toast.success("Verification successful");
			setOtp(data.code);
			setCurrentStep(3);
		} finally {
			setIsLoading(false);
		}
	};

	const onResetPasswordSubmit = async (data: ResetPasswordFormValues) => {
		setIsLoading(true);

		try {
			const res = await authClient.emailOtp.resetPassword({
				password: data.password,
				email: userEmail,
				otp,
			});

			if (!res.data || res.error) {
				toast.error(
					(res.error && res.error.message) || "Failed to reset password"
				);
				return;
			}

			toast.success("Password reset successful");
			setCurrentStep(4);
		} catch (error) {
			console.error("Password reset failed:", error);
			toast.error("Password reset failed");
		} finally {
			setIsLoading(false);
		}
	};

	const handleResendOTP = async () => {
		if (!userEmail || isResending) return;
		setIsResending(true);
		try {
			const res = await authClient.forgetPassword.emailOtp({
				email: userEmail,
			});
			if (res.error) {
				toast.error(res.error.message || "Failed to resend code");
				return;
			}
			toast.success("Reset code resent");
		} catch {
			toast.error("Failed to resend code");
		} finally {
			setIsResending(false);
		}
	};

	const handleReset = () => {
		setCurrentStep(1);
		emailForm.reset();
		verificationForm.reset();
		resetPasswordForm.reset();
		setUserEmail("");
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
					description="We'll send you an email to reset your password"
				>
					<Form {...emailForm}>
						<FormStep
							onSubmit={emailForm.handleSubmit(onEmailSubmit)}
							isLoading={isLoading}
							submitText="Send reset link"
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
				<StepWrapper
					title="Verify email"
					description={`We sent a 6-digit code to ${userEmail}`}
				>
					<Form {...verificationForm}>
						<FormStep
							onSubmit={verificationForm.handleSubmit(onVerificationSubmit)}
							isLoading={isLoading}
							submitText="Verify code"
							footerContent={
								<>
									Didn't receive a code?{" "}
									<button
										type="button"
										onClick={handleResendOTP}
										disabled={isLoading || isResending}
										className="text-primary hover:underline font-medium disabled:opacity-50"
									>
										{isResending ? "Sending..." : "Resend"}
									</button>
								</>
							}
						>
							<FormField
								control={verificationForm.control}
								name="code"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Verification Code</FormLabel>
										<FormControl>
											<Input
												placeholder="000000"
												type="text"
												inputMode="numeric"
												maxLength={6}
												{...field}
												disabled={isLoading}
												className="tracking-widest text-center text-lg font-semibold"
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
