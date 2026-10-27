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
import { useAuthActions } from "@/hooks/use-auth-actions";
import { validateRedirectSearch } from "@/lib/safe-redirect";
import { errorMessage, newPasswordSchema } from "@/lib/validation";
import { toast } from "sonner";

export const Route = createFileRoute("/_notauth/auth/register")({
	validateSearch: validateRedirectSearch,
	component: RouteComponent,
});

// Form validation schemas
const registerSchema = z
	.object({
		name: z.string().min(2, "Name must be at least 2 characters"),
		email: z.email("Invalid email address"),
		password: newPasswordSchema,
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords don't match",
		path: ["confirmPassword"],
	});

type RegisterFormValues = z.infer<typeof registerSchema>;

function RouteComponent() {
	const navigate = useNavigate();
	const { redirect } = Route.useSearch();
	const { completeLogin } = useAuthActions();
	const [currentStep, setCurrentStep] = useState(1);
	const [userEmail, setUserEmail] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	// Held only until the email is verified, to sign the user straight in.
	const [password, setPassword] = useState("");
	// Email whose signUp already succeeded (the OTP step's back button returns
	// to step 1; submitting again must not call signUp a second time).
	const [pendingEmail, setPendingEmail] = useState("");

	const registerForm = useForm<RegisterFormValues>({
		resolver: zodResolver(registerSchema),
		defaultValues: {
			name: "",
			email: "",
			password: "",
			confirmPassword: "",
		},
	});

	const sendCode = async (email: string) => {
		const { error } = await authClient.emailOtp.sendVerificationOtp({
			email,
			type: "email-verification",
		});
		if (error) throw new Error(error.message || "Failed to send code");
	};

	const onRegisterSubmit = async (values: RegisterFormValues) => {
		setIsLoading(true);
		try {
			setPassword(values.password);
			if (pendingEmail === values.email) {
				// Already signed up, only the code is missing
				await sendCode(values.email);
			} else {
				const { error } = await authClient.signUp.email({
					email: values.email,
					password: values.password,
					name: values.name,
				});

				if (error) {
					toast.error(error.message || "Registration failed");
					return;
				}
				setPendingEmail(values.email);
			}

			setUserEmail(values.email);
			setCurrentStep(2);
			toast.success("Verification email sent successfully");
		} catch (err) {
			toast.error(errorMessage(err, "An unexpected error occurred"));
		} finally {
			setIsLoading(false);
		}
	};

	const onVerificationSubmit = async (code: string) => {
		const { error } = await authClient.emailOtp.verifyEmail({
			email: userEmail,
			otp: code,
		});
		if (error) throw new Error(error.message || "Verification failed");

		// The account is verified: sign in right away and continue where the
		// user was headed (e.g. an invitation link). Organization is created by
		// the backend.
		const signedIn = await authClient.signIn.email({
			email: userEmail,
			password,
		});
		setPassword("");
		setPendingEmail("");
		if (signedIn.error) {
			setCurrentStep(3);
			return;
		}
		await completeLogin(redirect);
	};

	return (
		<AuthLayout
			totalSteps={3}
			currentStep={currentStep}
			onBack={() => setCurrentStep(currentStep - 1)}
			showBackButton={currentStep === 2}
		>
			{currentStep === 1 && (
				<StepWrapper
					title="Create account"
					description="Join us today and get started"
				>
					<Form {...registerForm}>
						<FormStep
							onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
							isLoading={isLoading}
							submitText="Continue"
							footerContent={
								<>
									Already have an account?{" "}
									<Link
										to="/auth/login"
										search={{ redirect }}
										className="text-primary hover:underline font-medium"
									>
										Sign in
									</Link>
								</>
							}
						>
							<FormField
								control={registerForm.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Full Name</FormLabel>
										<FormControl>
											<Input
												placeholder="John Doe"
												type="text"
												{...field}
												disabled={isLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={registerForm.control}
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
							<FormField
								control={registerForm.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Password</FormLabel>
										<FormControl>
											<Input
												placeholder="Enter your password"
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
								control={registerForm.control}
								name="confirmPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Confirm Password</FormLabel>
										<FormControl>
											<Input
												placeholder="Confirm your password"
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

			{currentStep === 2 && (
				<OtpStep
					email={userEmail}
					title="Verify email"
					submitText="Verify email"
					onSubmit={onVerificationSubmit}
					onResend={() => sendCode(userEmail)}
				/>
			)}

			{currentStep === 3 && (
				<StepWrapper
					title="Account created!"
					description="Your account has been successfully created"
				>
					<SuccessStep
						email={userEmail}
						title="Account created!"
						message="Welcome! Your account and organization have been created successfully."
						primaryAction={{
							label: "Go to login",
							onClick: () => navigate({ to: "/auth/login", search: { redirect } }),
						}}
					/>
				</StepWrapper>
			)}
		</AuthLayout>
	);
}
