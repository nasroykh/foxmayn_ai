import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
	FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useSession, authClient } from "@/lib/auth";
import { errorMessage } from "@/lib/validation";

const profileSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.email("Invalid email address"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export function ProfileTab() {
	const { data: sessionData } = useSession();
	const user = sessionData?.user;
	const [isUpdating, setIsUpdating] = useState(false);

	// `values` resets the form only when the server values actually change, and
	// react-hook-form keeps in-progress edits when the object is unchanged, so a
	// focus refetch of the session never wipes what the user is typing.
	const form = useForm<ProfileFormValues>({
		resolver: zodResolver(profileSchema),
		defaultValues: { name: "", email: "" },
		values: user ? { name: user.name, email: user.email } : undefined,
		resetOptions: { keepDirtyValues: true },
	});

	const onSubmit = async (values: ProfileFormValues) => {
		setIsUpdating(true);
		try {
			const { error } = await authClient.updateUser({
				name: values.name,
			});
			if (error) {
				toast.error(error.message || "Failed to update profile");
			} else {
				toast.success("Profile updated successfully");
			}
		} catch (err) {
			toast.error(errorMessage(err, "Failed to update profile"));
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile Information</CardTitle>
				<CardDescription>
					Update your account details and how others see you
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Full Name</FormLabel>
									<FormControl>
										<Input {...field} placeholder="Your name" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email Address</FormLabel>
									<FormControl>
										<Input {...field} disabled placeholder="Your email" />
									</FormControl>
									<FormDescription className="text-xs">
										Email cannot be changed directly. Contact support for
										assistance.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<div className="flex justify-end pt-2">
							<Button type="submit" disabled={isUpdating}>
								{isUpdating ? (
									<>
										<IconLoader2 className="mr-2 size-4 animate-spin" />
										Saving...
									</>
								) : (
									"Save Changes"
								)}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
