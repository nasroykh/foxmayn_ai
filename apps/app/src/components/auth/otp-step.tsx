import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { StepWrapper, FormStep } from "./auth-steps";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/validation";

const otpSchema = z.object({
	code: z.string().regex(/^\d{6}$/, "Verification code must be 6 digits"),
});
type OtpValues = z.infer<typeof otpSchema>;

interface OtpStepProps {
	email: string;
	title: string;
	submitText: string;
	/** Throw (or reject) to keep the user on this step; the message is toasted. */
	onSubmit: (code: string) => Promise<void>;
	onResend: () => Promise<void>;
}

/** 6-digit email code entry with resend, shared by register / login / reset. */
export function OtpStep({
	email,
	title,
	submitText,
	onSubmit,
	onResend,
}: OtpStepProps) {
	const [isLoading, setIsLoading] = useState(false);
	const form = useForm<OtpValues>({
		resolver: zodResolver(otpSchema),
		defaultValues: { code: "" },
	});

	const submit = async (values: OtpValues) => {
		setIsLoading(true);
		try {
			await onSubmit(values.code);
		} catch (err) {
			toast.error(errorMessage(err, "Verification failed"));
		} finally {
			setIsLoading(false);
		}
	};

	const resend = async () => {
		if (isLoading) return;
		setIsLoading(true);
		try {
			await onResend();
			toast.success("Code sent");
		} catch (err) {
			toast.error(errorMessage(err, "Failed to resend code"));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<StepWrapper
			title={title}
			description={`We sent a 6-digit code to ${email}`}
		>
			<Form {...form}>
				<FormStep
					onSubmit={form.handleSubmit(submit)}
					isLoading={isLoading}
					submitText={submitText}
					footerContent={
						<>
							Didn't receive a code?{" "}
							<button
								type="button"
								onClick={resend}
								disabled={isLoading}
								className="text-primary hover:underline font-medium disabled:opacity-50"
							>
								Resend
							</button>
						</>
					}
				>
					<FormField
						control={form.control}
						name="code"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Verification Code</FormLabel>
								<FormControl>
									<Input
										placeholder="000000"
										type="text"
										inputMode="numeric"
										autoComplete="one-time-code"
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
	);
}
