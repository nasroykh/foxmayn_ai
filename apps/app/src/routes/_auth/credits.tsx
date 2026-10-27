import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/validation";
import { hasAdminRole } from "@/lib/roles";
import { useMemberRole } from "@/hooks/use-member-role";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { IconPlus, IconLoader2, IconCoins } from "@tabler/icons-react";
import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
	ComboboxEmpty,
} from "@/components/ui/combobox";

export const Route = createFileRoute("/_auth/credits")({
	staticData: { title: "Credits" },
	component: CreditsPage,
});

const TX_TYPE_COLORS: Record<string, string> = {
	topup: "text-emerald-600 border-emerald-200 bg-emerald-50",
	usage: "text-blue-600 border-blue-200 bg-blue-50",
	refund: "text-purple-600 border-purple-200 bg-purple-50",
	adjustment: "text-orange-600 border-orange-200 bg-orange-50",
};

type TxType = "topup" | "usage" | "refund" | "adjustment";

function CreditsPage() {
	const { data: sessionData } = useSession();
	const isAdmin = hasAdminRole(sessionData?.user?.role);
	const { isManager } = useMemberRole();
	const queryClient = useQueryClient();

	const [txTypeFilter, setTxTypeFilter] = useState<string>("all");
	const [isTopUpOpen, setIsTopUpOpen] = useState(false);
	const [topUpOrgId, setTopUpOrgId] = useState<string | null>(null);
	const [topUpAmount, setTopUpAmount] = useState("");
	const [topUpDesc, setTopUpDesc] = useState("");

	const { data: balance, isLoading: balanceLoading } = useQuery(
		orpc.credits.getBalance.queryOptions({}),
	);

	// Transactions and stats are owner/admin only on the API (FORBIDDEN for members)
	const { data: transactions, isLoading: txLoading } = useQuery({
		...orpc.credits.getTransactions.queryOptions({
			input: {
				limit: 50,
				type: txTypeFilter !== "all" ? (txTypeFilter as TxType) : undefined,
			},
		}),
		enabled: isManager,
	});

	const { data: usageStats } = useQuery({
		...orpc.usage.getStats.queryOptions({ input: {} }),
		enabled: isManager,
	});

	const { data: usageHistory, isLoading: usageLoading } = useQuery(
		orpc.usage.getHistory.queryOptions({ input: { limit: 20 } }),
	);

	const [orgSearch, setOrgSearch] = useState("");
	const deferredOrgSearch = useDeferredValue(orgSearch.trim());
	const { data: orgsData } = useQuery({
		...orpc.organization.adminList.queryOptions({
			input: { search: deferredOrgSearch || undefined, limit: 50 },
		}),
		enabled: isAdmin && isTopUpOpen,
	});
	const organizations = orgsData?.organizations ?? [];

	const topUpMutation = useMutation(
		orpc.credits.topUp.mutationOptions({
			onSuccess: (data) => {
				toast.success(
					`Topped up successfully. New balance: $${data.newBalance?.toFixed(4)}`,
				);
				setIsTopUpOpen(false);
				setTopUpOrgId(null);
				setOrgSearch("");
				setTopUpAmount("");
				setTopUpDesc("");
				void queryClient.invalidateQueries({ queryKey: orpc.credits.key() });
			},
			onError: (err) => toast.error(errorMessage(err, "Top-up failed")),
		}),
	);

	const amountValue = Number(topUpAmount);
	const amountValid =
		Number.isFinite(amountValue) && amountValue > 0 && amountValue <= 10000;
	const targetOrgId = topUpOrgId;

	const txList = transactions?.transactions ?? [];
	const historyList = usageHistory?.history ?? [];

	return (
		<>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold">Credits</h1>
						<p className="text-muted-foreground text-sm">
							Balance, usage, and transaction history
						</p>
					</div>
					{isAdmin && (
						<Button onClick={() => setIsTopUpOpen(true)} className="gap-2">
							<IconPlus className="size-4" />
							Top Up
						</Button>
					)}
				</div>

				{/* Balance + Stats */}
				<div className={isManager ? "grid gap-4 md:grid-cols-4" : "grid gap-4 md:grid-cols-1"}>
					<Card className="md:col-span-1">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
								<IconCoins className="size-4" />
								Balance
							</CardTitle>
						</CardHeader>
						<CardContent>
							{balanceLoading ? (
								<Skeleton className="h-8 w-24" />
							) : (
								<div className="text-3xl font-bold">
									${Number(balance?.balance ?? 0).toFixed(4)}
								</div>
							)}
						</CardContent>
					</Card>

					{isManager && (<>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Total Ops
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{usageStats?.totalCalls ?? "—"}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Chat Ops
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{usageStats?.byOperation?.find((o) => o.operationType === "chat")?.totalCalls ?? "—"}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Embedding Ops
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{usageStats?.byOperation?.find((o) => o.operationType === "embedding")?.totalCalls ?? "—"}
							</div>
						</CardContent>
					</Card>
					</>)}
				</div>

				{/* Transactions (owners and admins only) */}
				{isManager && (
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<div>
							<CardTitle>Transactions</CardTitle>
							<CardDescription>
								Credit history for your organization
							</CardDescription>
						</div>
						<Select
							value={txTypeFilter}
							onValueChange={(value) => setTxTypeFilter(value || "all")}
						>
							<SelectTrigger className="w-36" aria-label="Filter by type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Types</SelectItem>
								<SelectItem value="topup">Top-up</SelectItem>
								<SelectItem value="usage">Usage</SelectItem>
								<SelectItem value="refund">Refund</SelectItem>
								<SelectItem value="adjustment">Adjustment</SelectItem>
							</SelectContent>
						</Select>
					</CardHeader>
					<CardContent>
						<div className="rounded-md border border-input overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Type</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Date</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{txLoading ? (
										Array.from({ length: 5 }).map((_, i) => (
											<TableRow key={i}>
												{Array.from({ length: 4 }).map((_, j) => (
													<TableCell key={j}>
														<Skeleton className="h-4 w-full" />
													</TableCell>
												))}
											</TableRow>
										))
									) : txList.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={4}
												className="h-24 text-center text-muted-foreground"
											>
												No transactions found
											</TableCell>
										</TableRow>
									) : (
										txList.map((tx) => (
											<TableRow key={tx.id}>
												<TableCell>
													<Badge
														variant="outline"
														className={TX_TYPE_COLORS[tx.type] ?? ""}
													>
														{tx.type}
													</Badge>
												</TableCell>
												<TableCell
													className={
														Number(tx.amount) > 0
															? "text-emerald-600 font-medium"
															: "text-destructive font-medium"
													}
												>
													{Number(tx.amount) > 0 ? "+" : ""}$
													{Math.abs(Number(tx.amount)).toFixed(4)}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{tx.description || "—"}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{tx.createdAt
														? format(
																new Date(tx.createdAt),
																"MMM d, yyyy HH:mm",
															)
														: "—"}
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>
				)}

				{/* Usage History */}
				<Card>
					<CardHeader>
						<CardTitle>Usage History</CardTitle>
						<CardDescription>
							{isManager ? "Recent AI operations" : "Your recent AI operations"}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="rounded-md border border-input overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Operation</TableHead>
										<TableHead>Model</TableHead>
										<TableHead>Tokens</TableHead>
										<TableHead>Cost</TableHead>
										<TableHead>Date</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{usageLoading ? (
										Array.from({ length: 5 }).map((_, i) => (
											<TableRow key={i}>
												{Array.from({ length: 5 }).map((_, j) => (
													<TableCell key={j}>
														<Skeleton className="h-4 w-full" />
													</TableCell>
												))}
											</TableRow>
										))
									) : historyList.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={5}
												className="h-24 text-center text-muted-foreground"
											>
												No usage history
											</TableCell>
										</TableRow>
									) : (
										historyList.map((h, i) => (
											<TableRow key={h.id ?? i}>
												<TableCell>
													<Badge variant="outline">{h.operationType}</Badge>
												</TableCell>
												<TableCell className="font-mono text-xs">
													{h.model}
												</TableCell>
												<TableCell>
													{h.totalTokens ?? h.inputTokens + h.outputTokens}
												</TableCell>
												<TableCell className="text-muted-foreground">
													${Number(h.costCredits ?? 0).toFixed(6)}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{h.createdAt
														? format(new Date(h.createdAt), "MMM d, HH:mm")
														: "—"}
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Top Up Dialog (admin only) */}
			{isAdmin && (
				<Dialog open={isTopUpOpen} onOpenChange={setIsTopUpOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Top Up Credits</DialogTitle>
							<DialogDescription>
								Add credits to an organization
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="topup-org">Organization</Label>
								<Combobox
									value={topUpOrgId}
									onValueChange={(value) => setTopUpOrgId(value)}
									onInputValueChange={(value) => setOrgSearch(value)}
									items={organizations.map((org) => ({
										label: `${org.name} (${org.slug})`,
										value: org.id,
									}))}
								>
									<ComboboxInput
										id="topup-org"
										className="w-full"
										placeholder="Search organization..."
										showClear
									/>
									<ComboboxContent>
										<ComboboxEmpty>No organizations found</ComboboxEmpty>
										<ComboboxList>
											{(org: { label: string; value: string }) => (
												<ComboboxItem key={org.value} value={org.value}>
													{org.label}
												</ComboboxItem>
											)}
										</ComboboxList>
									</ComboboxContent>
								</Combobox>
							</div>
							<div className="space-y-2">
								<Label htmlFor="topup-amount">Amount ($)</Label>
								<Input
									id="topup-amount"
									type="number"
									min="0.01"
									max="10000"
									step="0.01"
									placeholder="10.00"
									value={topUpAmount}
									onChange={(e) => setTopUpAmount(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="topup-desc">Description (optional)</Label>
								<Input
									id="topup-desc"
									placeholder="Manual top-up"
									value={topUpDesc}
									onChange={(e) => setTopUpDesc(e.target.value)}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setIsTopUpOpen(false)}>
								Cancel
							</Button>
							<Button
								disabled={
									!targetOrgId || !amountValid || topUpMutation.isPending
								}
								onClick={() =>
									topUpMutation.mutate({
										organizationId: targetOrgId!,
										amount: amountValue,
										description: topUpDesc || undefined,
									})
								}
							>
								{topUpMutation.isPending && (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								)}
								Top Up
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
