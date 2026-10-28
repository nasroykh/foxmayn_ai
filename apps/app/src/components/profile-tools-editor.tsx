import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { IconPlus, IconTrash, IconEdit, IconCheck } from "@tabler/icons-react";
import {
	MAX_TOOLS,
	emptyToolDraft,
	validateTools,
	type ToolDraft,
} from "@/lib/profile-tools";

function FieldError({ message }: { message?: string }) {
	return message ? (
		<p className="text-xs text-destructive" role="alert">
			{message}
		</p>
	) : null;
}

export function ProfileToolsEditor({
	value,
	onChange,
}: {
	value: ToolDraft[];
	onChange: (tools: ToolDraft[]) => void;
}) {
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const errors = validateTools(value);

	const update = (index: number, patch: Partial<ToolDraft>) =>
		onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)));

	const add = () => {
		onChange([...value, emptyToolDraft()]);
		setOpenIndex(value.length);
	};

	const remove = (index: number) => {
		onChange(value.filter((_, i) => i !== index));
		setOpenIndex((current) =>
			current === null || current === index
				? null
				: current > index
					? current - 1
					: current,
		);
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<Label>
					Tools ({value.length}/{MAX_TOOLS})
				</Label>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-1"
					disabled={value.length >= MAX_TOOLS}
					onClick={add}
				>
					<IconPlus className="size-4" />
					Add tool
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				Tools are run by the API client: the model asks for a call, the client
				executes it and sends the result to /chat/continue.
			</p>
			{value.length === 0 && (
				<p className="text-xs text-muted-foreground">No tools yet.</p>
			)}
			{value.map((tool, index) => {
				const toolErrors = errors[index] ?? {};
				const invalid = Object.keys(toolErrors).length > 0;
				const open = openIndex === index;
				return (
					<div key={index} className="space-y-3 rounded-md border p-3">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0 space-y-0.5">
								<div className="flex items-center gap-2">
									<span className="truncate font-mono text-sm">
										{tool.name || "(unnamed)"}
									</span>
									<Badge variant={tool.enabled ? "secondary" : "outline"}>
										{tool.enabled ? "Enabled" : "Disabled"}
									</Badge>
									{invalid && (
										<Badge variant="destructive">Needs fixing</Badge>
									)}
								</div>
								<p className="line-clamp-1 text-xs text-muted-foreground">
									{tool.description || "No description"}
								</p>
							</div>
							<div className="flex shrink-0 gap-1">
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7"
									aria-label={`${open ? "Close" : "Edit"} tool ${tool.name}`}
									onClick={() => setOpenIndex(open ? null : index)}
								>
									{open ? (
										<IconCheck className="size-4" />
									) : (
										<IconEdit className="size-4" />
									)}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7 text-destructive"
									aria-label={`Delete tool ${tool.name}`}
									onClick={() => remove(index)}
								>
									<IconTrash className="size-4" />
								</Button>
							</div>
						</div>
						{open && (
							<div className="space-y-3">
								<div className="space-y-2">
									<Label htmlFor={`tool-name-${index}`}>Name *</Label>
									<Input
										id={`tool-name-${index}`}
										value={tool.name}
										onChange={(e) => update(index, { name: e.target.value })}
										placeholder="get_weather"
										className="font-mono"
									/>
									<FieldError message={toolErrors.name} />
								</div>
								<div className="space-y-2">
									<Label htmlFor={`tool-description-${index}`}>
										Description *
									</Label>
									<Textarea
										id={`tool-description-${index}`}
										value={tool.description}
										onChange={(e) =>
											update(index, { description: e.target.value })
										}
										className="min-h-[60px]"
										placeholder="What the tool does and when to call it"
									/>
									<FieldError message={toolErrors.description} />
								</div>
								<div className="space-y-2">
									<Label htmlFor={`tool-parameters-${index}`}>
										Parameters (JSON schema) *
									</Label>
									<Textarea
										id={`tool-parameters-${index}`}
										value={tool.parameters}
										onChange={(e) =>
											update(index, { parameters: e.target.value })
										}
										className="min-h-[140px] font-mono text-xs"
										spellCheck={false}
									/>
									<FieldError message={toolErrors.parameters} />
								</div>
								<div className="flex items-center gap-2">
									<input
										type="checkbox"
										id={`tool-enabled-${index}`}
										className="size-4"
										checked={tool.enabled}
										onChange={(e) =>
											update(index, { enabled: e.target.checked })
										}
									/>
									<Label htmlFor={`tool-enabled-${index}`}>Enabled</Label>
								</div>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
