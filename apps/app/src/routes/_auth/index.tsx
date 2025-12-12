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
import { DollarSign, Users, Activity, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, XAxis, YAxis } from "recharts";
import { Layout } from "@/components/layout/layout";

export const Route = createFileRoute("/_auth/")({
	component: Dashboard,
});

const stats = [
	{
		title: "Total Revenue",
		value: "$45,231.89",
		change: "+20.1%",
		icon: DollarSign,
	},
	{
		title: "Active Users",
		value: "2,350",
		change: "+180.1%",
		icon: Users,
	},
	{
		title: "Active Sessions",
		value: "12,234",
		change: "+19%",
		icon: Activity,
	},
	{
		title: "Growth Rate",
		value: "+573",
		change: "+201",
		icon: TrendingUp,
	},
];

const revenueData = [
	{ month: "Jan", revenue: 4000 },
	{ month: "Feb", revenue: 3000 },
	{ month: "Mar", revenue: 5000 },
	{ month: "Apr", revenue: 4500 },
	{ month: "May", revenue: 6000 },
	{ month: "Jun", revenue: 5500 },
];

const usersData = [
	{ month: "Jan", users: 400 },
	{ month: "Feb", users: 600 },
	{ month: "Mar", users: 550 },
	{ month: "Apr", users: 780 },
	{ month: "May", users: 890 },
	{ month: "Jun", users: 1200 },
];

const chartConfig = {
	revenue: {
		label: "Revenue",
		color: "var(--chart-1)",
	},
	users: {
		label: "Users",
		color: "var(--chart-2)",
	},
};

function Dashboard() {
	return (
		<Layout>
			<div className="space-y-6">
				{/* Stats Cards */}
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{stats.map((stat) => (
						<Card key={stat.title}>
							<CardHeader className="flex flex-row items-center justify-between pb-2">
								<CardTitle className="text-sm font-medium text-muted-foreground">
									{stat.title}
								</CardTitle>
								<stat.icon className="size-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{stat.value}</div>
								<p className="text-xs text-muted-foreground">
									<span className="text-emerald-500">{stat.change}</span> from
									last month
								</p>
							</CardContent>
						</Card>
					))}
				</div>

				{/* Charts */}
				<div className="grid gap-4 md:grid-cols-2">
					{/* Revenue Chart */}
					<Card>
						<CardHeader>
							<CardTitle>Revenue Overview</CardTitle>
							<CardDescription>
								Monthly revenue for the last 6 months
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ChartContainer config={chartConfig} className="h-[200px] w-full">
								<AreaChart data={revenueData}>
									<defs>
										<linearGradient
											id="fillRevenue"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
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
										dataKey="month"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Area
										type="monotone"
										dataKey="revenue"
										stroke="var(--chart-1)"
										fillOpacity={1}
										fill="url(#fillRevenue)"
									/>
								</AreaChart>
							</ChartContainer>
						</CardContent>
					</Card>

					{/* Users Chart */}
					<Card>
						<CardHeader>
							<CardTitle>User Growth</CardTitle>
							<CardDescription>New users acquired per month</CardDescription>
						</CardHeader>
						<CardContent>
							<ChartContainer config={chartConfig} className="h-[200px] w-full">
								<BarChart data={usersData}>
									<XAxis
										dataKey="month"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Bar
										dataKey="users"
										fill="var(--chart-2)"
										radius={[4, 4, 0, 0]}
									/>
								</BarChart>
							</ChartContainer>
						</CardContent>
					</Card>
				</div>
			</div>
		</Layout>
	);
}
