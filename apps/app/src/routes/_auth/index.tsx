import { createFileRoute } from "@tanstack/react-router";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
	IconCoins,
	IconFileText,
	IconMessage,
	IconActivity,
} from "@tabler/icons-react";
import { orpc } from "@/lib/orpc";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useMemo } from "react";
import { format, subDays } from "date-fns";
import { useMemberRole } from "@/hooks/use-member-role";

// recharts is large; load it only when the dashboard renders the chart
const UsageChart = lazy(() => import("@/components/dashboard/usage-chart"));

export const Route = createFileRoute("/_auth/")({
	staticData: { title: "Dashboard" },
	component: Dashboard,
});

const HISTORY_LIMIT = 100;

const TX_TYPE_COLORS: Record<string, string> = {
	topup: "text-emerald-600 border-emerald-200 bg-emerald-50",
	usage: "text-blue-600 border-blue-200 bg-blue-50",
	refund: "text-purple-600 border-purple-200 bg-purple-50",
	adjustment: "text-orange-600 border-orange-200 bg-orange-50",
};

function Dashboard() {
	const { isManager } = useMemberRole();

	const { data: balance, isLoading: balanceLoading } = useQuery(
		orpc.credits.getBalance.queryOptions({}),
	);

	const { data: docs, isLoading: docsLoading } = useQuery(
		orpc.documents.listDocuments.queryOptions({ input: { limit: 1 } }),
	);

	const { data: convs, isLoading: convsLoading } = useQuery(
		orpc.conversations.listConversations.queryOptions({ input: { limit: 1 } }),
	);

	// Keyed by calendar day (not by a fresh Date) so the query is cached
	const today = format(new Date(), "yyyy-MM-dd");
	const todayStart = useMemo(() => new Date(`${today}T00:00:00`), [today]);

	// Owner/admin only on the API (FORBIDDEN for plain members)
	const { data: usageStats, isLoading: statsLoading } = useQuery({
		...orpc.usage.getStats.queryOptions({ input: { from: todayStart } }),
		enabled: isManager,
	});

	// Members only receive their own rows
	const { data: usageHistory } = useQuery(
		orpc.usage.getHistory.queryOptions({
			input: { limit: HISTORY_LIMIT },
		}),
	);

	const { data: transactions } = useQuery({
		...orpc.credits.getTransactions.queryOptions({ input: { limit: 5 } }),
		enabled: isManager,
	});

	// Chart data from the most recent usage rows (last 7 days)
	const historyList = usageHistory?.history ?? [];
	const last7Days = Array.from({ length: 7 }, (_, i) => {
		const date = subDays(new Date(), 6 - i);
		const dateStr = format(date, "MMM d");
		const cost = historyList
			.filter((h) => format(new Date(h.createdAt), "MMM d") === dateStr)
			.reduce((sum: number, h) => sum + Number(h.costCredits ?? 0), 0);
		return { date: dateStr, cost: parseFloat(cost.toFixed(6)) };
	});
	const chartTruncated = historyList.length >= HISTORY_LIMIT;

	const opsToday = isManager
		? (usageStats?.totalCalls ?? 0)
		: historyList.filter((h) => new Date(h.createdAt) >= todayStart).length;
	const opsLoading = isManager ? statsLoading : usageHistory === undefined;

	const txList = transactions?.transactions ?? [];

	return (
		<div className="space-y-6">
				{/* Stats Cards */}
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<Card>
						<CardHeader className="flex flex-row items-center justify-between pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Credits Balance
							</CardTitle>
							<IconCoins className="size-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							{balanceLoading ? (
								<Skeleton className="h-8 w-24" />
							) : (
								<div className="text-2xl font-bold">
									${Number(balance?.balance ?? 0).toFixed(4)}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Documents
							</CardTitle>
							<IconFileText className="size-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							{docsLoading ? (
								<Skeleton className="h-8 w-16" />
							) : (
								<div className="text-2xl font-bold">
									{docs?.total ?? 0}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Conversations
							</CardTitle>
							<IconMessage className="size-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							{convsLoading ? (
								<Skeleton className="h-8 w-16" />
							) : (
								<div className="text-2xl font-bold">
									{convs?.total ?? 0}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Ops Today
							</CardTitle>
							<IconActivity className="size-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							{opsLoading ? (
								<Skeleton className="h-8 w-16" />
							) : (
								<div className="text-2xl font-bold">
									{opsToday}
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					{/* Usage Chart */}
					<Card>
						<CardHeader>
							<CardTitle>Usage Cost (Last 7 Days)</CardTitle>
							<CardDescription>Daily AI operation costs</CardDescription>
						</CardHeader>
						<CardContent>
							<Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
								<UsageChart data={last7Days} />
							</Suspense>
							{chartTruncated && (
								<p className="mt-2 text-xs text-muted-foreground">
									Based on the {HISTORY_LIMIT} most recent operations; older
									days may be undercounted.
								</p>
							)}
						</CardContent>
					</Card>

					{/* Recent Transactions (owners and admins only) */}
					{isManager && (
					<Card>
						<CardHeader>
							<CardTitle>Recent Transactions</CardTitle>
							<CardDescription>Latest credit activity</CardDescription>
						</CardHeader>
						<CardContent>
							{txList.length === 0 ? (
								<p className="text-sm text-muted-foreground text-center py-8">
									No transactions yet
								</p>
							) : (
								<div className="space-y-3">
									{txList.map((tx) => (
										<div
											key={tx.id}
											className="flex items-center justify-between"
										>
											<div className="flex items-center gap-2">
												<Badge
													variant="outline"
													className={`text-xs ${TX_TYPE_COLORS[tx.type] ?? ""}`}
												>
													{tx.type}
												</Badge>
												<span className="text-sm text-muted-foreground truncate max-w-[150px]">
													{tx.description || "—"}
												</span>
											</div>
											<span
												className={`text-sm font-medium ${Number(tx.amount) > 0 ? "text-emerald-600" : "text-destructive"}`}
											>
												{Number(tx.amount) > 0 ? "+" : ""}$
												{Math.abs(Number(tx.amount)).toFixed(4)}
											</span>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
					)}
				</div>
		</div>
	);
}
