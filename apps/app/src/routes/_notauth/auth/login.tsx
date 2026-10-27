import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { IconLoader2 } from "@tabler/icons-react";
import { OtpStep } from "@/components/auth";
import { authClient } from "@/lib/auth";
import { useAuthActions } from "@/hooks/use-auth-actions";
import { validateRedirectSearch } from "@/lib/safe-redirect";
import { errorMessage } from "@/lib/validation";
import { toast } from "sonner";

export const Route = createFileRoute("/_notauth/auth/login")({
	validateSearch: validateRedirectSearch,
	component: RouteComponent,
});

// Existing passwords may predate the current rules (e.g. admin-set), so login
// only requires a value.
const loginSchema = z.object({
	email: z.email("Invalid email address"),
	password: z.string().min(1, "Password is required"),
});

function isEmailNotVerified(error: {
	code?: string;
	status?: number;
	message?: string;
}) {
	return (
		error.code === "EMAIL_NOT_VERIFIED" ||
		(error.status === 403 && /verif/i.test(error.message ?? ""))
	);
}

type LoginFormValues = z.infer<typeof loginSchema>;

function RouteComponent() {
	const { redirect } = Route.useSearch();
	const { completeLogin } = useAuthActions();
	const [isLoading, setIsLoading] = useState(false);
	// Set when the account exists but its email was never verified.
	const [unverified, setUnverified] = useState<{
		email: string;
		password: string;
	} | null>(null);

	const form = useForm<LoginFormValues>({
		resolver: zodResolver(loginSchema),
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const onSubmit = async (values: LoginFormValues) => {
		setIsLoading(true);
		try {
			const { error, data } = await authClient.signIn.email({
				email: values.email,
				password: values.password,
			});

			if (error && isEmailNotVerified(error)) {
				const sent = await authClient.emailOtp.sendVerificationOtp({
					email: values.email,
					type: "email-verification",
				});
				if (sent.error) {
					toast.error(sent.error.message || "Failed to send verification code");
					return;
				}
				setUnverified({ email: values.email, password: values.password });
				toast.info("Verify your email to continue");
				return;
			}

			if (error || !data?.user) {
				toast.error(error?.message || "Login failed");
				return;
			}

			await completeLogin(redirect);
		} catch (err) {
			toast.error(errorMessage(err, "An unexpected error occurred"));
		} finally {
			setIsLoading(false);
		}
	};

	if (unverified) {
		return (
			<div className="min-h-screen flex flex-col items-center justify-center px-4">
				<OtpStep
					email={unverified.email}
					title="Verify your email"
					submitText="Verify and sign in"
					onSubmit={async (code) => {
						const verified = await authClient.emailOtp.verifyEmail({
							email: unverified.email,
							otp: code,
						});
						if (verified.error) {
							throw new Error(verified.error.message || "Verification failed");
						}
						const signedIn = await authClient.signIn.email({
							email: unverified.email,
							password: unverified.password,
						});
						if (signedIn.error) {
							setUnverified(null);
							throw new Error(
								signedIn.error.message || "Verified. Please sign in.",
							);
						}
						await completeLogin(redirect);
					}}
					onResend={async () => {
						const sent = await authClient.emailOtp.sendVerificationOtp({
							email: unverified.email,
							type: "email-verification",
						});
						if (sent.error) throw new Error(sent.error.message);
					}}
				/>
				<button
					type="button"
					onClick={() => setUnverified(null)}
					className="mt-4 text-sm text-primary hover:underline font-medium"
				>
					Back to sign in
				</button>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex flex-col items-center justify-center px-4 transition-colors duration-300">
			{/* Login Card */}
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<CardTitle className="text-2xl">Welcome back</CardTitle>
					<CardDescription>Sign in to your account to continue</CardDescription>
				</CardHeader>

				<CardContent>
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
							{/* Email Field */}
							<FormField
								control={form.control}
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

							{/* Password Field */}
							<FormField
								control={form.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Password</FormLabel>
										<FormControl>
											<Input
												placeholder="Enter your password"
												type="password"
												autoComplete="current-password"
												{...field}
												disabled={isLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Forgot Password Link */}
							<div className="flex justify-end">
								<Link
									to="/auth/forgot-password"
									className="text-sm text-primary hover:underline font-medium"
								>
									Forgot password?
								</Link>
							</div>

							{/* Submit Button */}
							<Button
								type="submit"
								className="w-full mt-6"
								disabled={isLoading}
							>
								{isLoading ? (
									<>
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
										Signing in...
									</>
								) : (
									"Sign in"
								)}
							</Button>
						</form>
					</Form>

					{/* Footer Links */}
					<div className="mt-4 text-center text-sm text-muted-foreground">
						<p>
							Don't have an account?{" "}
							<Link
								to="/auth/register"
								search={{ redirect }}
								className="text-primary hover:underline font-medium"
							>
								Sign up
							</Link>
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Decorative Element */}
			<div className="absolute inset-0 -z-10 bg-linear-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
		</div>
	);
}
