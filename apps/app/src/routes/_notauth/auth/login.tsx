import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth";
import { ensureActiveOrganization } from "@/lib/organization";
import { toast } from "sonner";
import { useSetAtom } from "jotai";
import { tokenAtom, userAtom } from "@/atoms/auth";

export const Route = createFileRoute("/_notauth/auth/login")({
	component: RouteComponent,
});

const loginSchema = z.object({
	email: z.email("Invalid email address"),
	password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function RouteComponent() {
	const $setUser = useSetAtom(userAtom);
	const $setToken = useSetAtom(tokenAtom);
	const [isLoading, setIsLoading] = useState(false);
	const navigate = useNavigate();

	const form = useForm<LoginFormValues>({
		resolver: zodResolver(loginSchema),
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const onSubmit = async (data: LoginFormValues) => {
		setIsLoading(true);

		try {
			const res = await authClient.signIn.email({
				email: data.email,
				password: data.password,
				rememberMe: true,
			});

			if (!res.data || res.error) {
				toast.error((res.error && res.error.message) || "Invalid credentials");
				return;
			}

			// Ensure user has an active organization
			await ensureActiveOrganization(res.data.user.name);

			$setUser(res.data.user);
			$setToken(res.data.token);

			toast.success("Login successful");
			navigate({ to: "/" });
		} catch (error) {
			console.error("Login failed:", error);
			toast.error("Login failed");
		} finally {
			setIsLoading(false);
		}
	};

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
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
