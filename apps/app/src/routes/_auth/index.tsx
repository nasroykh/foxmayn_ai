import { createFileRoute } from "@tanstack/react-router";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { Layout } from "@/components/layout/layout";
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
import { useMemo } from "react";
import { format, subDays } from "date-fns";

export const Route = createFileRoute("/_auth/")({
	component: Dashboard,
});

const chartConfig = {
	cost: {
		label: "Cost ($)",
		color: "var(--chart-1)",
	},
};

const TX_TYPE_COLORS: Record<string, string> = {
	topup: "text-emerald-600 border-emerald-200 bg-emerald-50",
	usage: "text-blue-600 border-blue-200 bg-blue-50",
	refund: "text-purple-600 border-purple-200 bg-purple-50",
	adjustment: "text-orange-600 border-orange-200 bg-orange-50",
};

function Dashboard() {
	const { data: balance, isLoading: balanceLoading } = useQuery(
		orpc.credits.getBalance.queryOptions({}),
	);

	const { data: docs, isLoading: docsLoading } = useQuery(
		orpc.documents.listDocuments.queryOptions({ input: { limit: 1 } }),
	);

	const { data: convs, isLoading: convsLoading } = useQuery(
		orpc.conversations.listConversations.queryOptions({ input: { limit: 1 } }),
	);

	const statsDateRange = useMemo(
		() => ({ from: subDays(new Date(), 1), to: new Date() }),
		[], // intentionally empty: snapshot dates at mount time
	);

	const { data: usageStats, isLoading: statsLoading } = useQuery(
		orpc.usage.getStats.queryOptions({
			input: statsDateRange,
		}),
	);

	const { data: usageHistory } = useQuery(
		orpc.usage.getHistory.queryOptions({
			input: { limit: 100 },
		}),
	);

	const { data: transactions } = useQuery(
		orpc.credits.getTransactions.queryOptions({ input: { limit: 5 } }),
	);

	// Build chart data from usage history (last 7 days)
	const historyList = (usageHistory as any)?.history ?? [];
	const last7Days = Array.from({ length: 7 }, (_, i) => {
		const date = subDays(new Date(), 6 - i);
		const dateStr = format(date, "MMM d");
		const cost = historyList
			.filter((h: any) => format(new Date(h.createdAt), "MMM d") === dateStr)
			.reduce((sum: number, h: any) => sum + Number(h.cost ?? 0), 0);
		return { date: dateStr, cost: parseFloat(cost.toFixed(6)) };
	});

	const txList = (transactions as any)?.transactions ?? [];

	return (
		<Layout>
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
									${Number((balance as any)?.balance ?? 0).toFixed(4)}
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
									{(docs as any)?.total ?? 0}
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
									{(convs as any)?.total ?? 0}
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
							{statsLoading ? (
								<Skeleton className="h-8 w-16" />
							) : (
								<div className="text-2xl font-bold">
									{(usageStats as any)?.totalOperations ?? 0}
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
							<ChartContainer config={chartConfig} className="h-[200px] w-full">
								<AreaChart data={last7Days}>
									<defs>
										<linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
											<stop
												offset="5%"
												stopColor="var(--chart-1)"
												stopOpacity={0.8}
											/>
											<stop
												offset="95%"
												stopColor="var(--chart-1)"
												stopOpacity={0.1}
											/>
										</linearGradient>
									</defs>
									<XAxis
										dataKey="date"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Area
										type="monotone"
										dataKey="cost"
										stroke="var(--chart-1)"
										fillOpacity={1}
										fill="url(#fillCost)"
									/>
								</AreaChart>
							</ChartContainer>
						</CardContent>
					</Card>

					{/* Recent Transactions */}
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
									{txList.map((tx: any) => (
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
												className={`text-sm font-medium ${tx.amount > 0 ? "text-emerald-600" : "text-destructive"}`}
											>
												{tx.amount > 0 ? "+" : ""}$
												{Math.abs(tx.amount).toFixed(4)}
											</span>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</Layout>
	);
}
