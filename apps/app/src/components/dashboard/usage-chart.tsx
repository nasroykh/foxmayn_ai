import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, XAxis, YAxis } from "recharts";

const chartConfig = {
	cost: {
		label: "Cost ($)",
		color: "var(--chart-1)",
	},
};

export type UsageChartPoint = { date: string; cost: number };

/** Lazy-loaded by the dashboard so recharts stays out of the entry chunk. */
export default function UsageChart({ data }: { data: UsageChartPoint[] }) {
	return (
		<ChartContainer config={chartConfig} className="h-[200px] w-full">
			<AreaChart data={data}>
				<defs>
					<linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
						<stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
					</linearGradient>
				</defs>
				<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
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
	);
}
