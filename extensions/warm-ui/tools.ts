/**
 * Tool rows: a status dot, the tool name and a one-line summary, with the output in a gutter below.
 *
 *  ● bash  rg -n limit src                                  0.4s
 *  │ src/rate-limit.js:11:    return entry.count <= limit;
 *
 * The dot is dim while the arguments stream, accent while the tool runs, success when it is done
 * and error when it failed. Result bodies come from the tool's own renderer, so previews, diffs,
 * highlighting and "ctrl+o to expand" keep working. Subagent runs get their own body.
 */
import type { Theme, ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { describeTool, previewArgs, stripCd } from "./describe.ts";
import { firstLine, formatDuration, spread, str, trimBlank } from "./format.ts";
import { isSubagentDetails, renderSubagentBody, subagentSummary } from "./subagent.ts";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
type RenderResult = NonNullable<ToolRenderers["renderResult"]>;
type RenderContext = Parameters<RenderCall>[2];
type ToolResult = Parameters<RenderResult>[0];
type ResultOptions = Parameters<RenderResult>[1];
type Status = "pending" | "running" | "done" | "error";

/** Row state, kept in the shared renderer state of the tool call. Keys have a prefix to stay clear of pi's own. */
interface RowState {
	wuStart?: number;
	wuEnd?: number;
	wuTimer?: ReturnType<typeof setInterval>;
	wuBaseCall?: Component;
	wuBaseResult?: Component;
	/** Short result facts for the header: diff stats, line count, exit code. */
	wuInfo?: string;
}

const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

function statusOf(ctx: RenderContext): Status {
	if (ctx.isError) return "error";
	if (!ctx.isPartial) return "done";
	return ctx.executionStarted ? "running" : "pending";
}

function dot(status: Status, theme: Theme): string {
	if (status === "pending") return theme.fg("dim", "○");
	if (status === "running") return theme.fg("accent", "●");
	return theme.fg(status === "done" ? "success" : "error", "●");
}

function stopTimer(st: RowState): void {
	if (st.wuTimer) clearInterval(st.wuTimer);
	st.wuTimer = undefined;
}

/** Start the clock when the tool starts, tick once a second while it runs, stop it with the result. */
function track(st: RowState, ctx: RenderContext, status: Status): void {
	if (status === "done" || status === "error") {
		if (st.wuStart !== undefined) st.wuEnd ??= Date.now();
		stopTimer(st);
		return;
	}
	if (status !== "running") return;
	st.wuStart ??= Date.now();
	if (st.wuTimer) return;
	const timer = setInterval(() => {
		if (st.wuEnd !== undefined || Date.now() - (st.wuStart ?? 0) > MAX_TIMER_MS) return stopTimer(st);
		ctx.invalidate();
	}, 1000);
	// HTML export renders a call as running and never ticks. The timer must not keep the process alive.
	timer.unref?.();
	st.wuTimer = timer;
}

/** Lines in a gutter: " │ line". */
class Gutter implements Component {
	body?: Component;
	constructor(public theme: Theme) {}

	render(width: number): string[] {
		if (!this.body) return [];
		const bar = this.theme.fg("borderMuted", "│");
		return trimBlank(this.body.render(Math.max(1, width - 3))).map((line) => ` ${bar} ${line}`);
	}

	invalidate(): void {
		this.body?.invalidate();
	}
}

/** The header line of a tool row, plus call details (a long command, a written file) in the gutter. */
class CallRow implements Component {
	dot = "";
	label = "";
	meta = "";
	/** The tool's own call component. Without a label, its first line becomes the label. */
	head?: Component;
	readonly gutter: Gutter;

	constructor(theme: Theme) {
		this.gutter = new Gutter(theme);
	}

	render(width: number): string[] {
		let label = this.label;
		let extra: string[] = [];
		if (this.head) {
			const lines = trimBlank(this.head.render(Math.max(1, width - 3)));
			if (label) extra = trimBlank(lines.slice(1));
			else [label = "", ...extra] = lines;
		}
		const bar = this.gutter.theme.fg("borderMuted", "│");
		return [spread(` ${this.dot} ${label}`, this.meta, width), ...extra.map((l) => ` ${bar} ${l}`), ...this.gutter.render(width)];
	}

	invalidate(): void {
		this.head?.invalidate();
		this.gutter.invalidate();
	}
}

function title(name: string, theme: Theme): string {
	return theme.bold(theme.fg("toolTitle", name));
}

function textOf(result: ToolResult): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function fallbackBody(result: ToolResult, options: ResultOptions, theme: Theme): Component {
	const lines = textOf(result).split("\n");
	const max = options.expanded ? lines.length : 8;
	let text = lines
		.slice(0, max)
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
	if (lines.length > max) text += `\n${theme.fg("muted", `… ${lines.length - max} more lines`)}`;
	return new Text(text, 0, 0);
}

function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

/** Diff stats for edit, the line count for read, the exit code for a failed shell command. */
function resultInfo(toolName: string, result: ToolResult, isError: boolean, isPartial: boolean, theme: Theme): string | undefined {
	if (isPartial) return undefined;
	if (toolName === "edit" && !isError) {
		const diff = (result.details as { diff?: unknown } | undefined)?.diff;
		if (typeof diff !== "string") return undefined;
		const { added, removed } = diffStats(diff);
		return `${theme.fg("success", `+${added}`)} ${theme.fg("error", `−${removed}`)}`;
	}
	if (toolName === "read" && !isError) {
		if (result.content.some((part) => part.type === "image")) return theme.fg("dim", "image");
		const text = textOf(result);
		return text ? theme.fg("dim", `${text.split("\n").length} lines`) : undefined;
	}
	if ((toolName === "bash" || toolName === "powershell") && isError) {
		const code = textOf(result).match(/exit(?:ed with)? code:? (-?\d+)/i)?.[1];
		return code ? theme.fg("error", `exit ${code}`) : undefined;
	}
	return undefined;
}

function makeRenderCall(toolName: string, base: ToolRenderers | undefined): RenderCall {
	return (args, theme, ctx) => {
		const st = ctx.state as RowState;
		const status = statusOf(ctx);
		track(st, ctx, status);

		const row = ctx.lastComponent instanceof CallRow ? ctx.lastComponent : new CallRow(theme);
		row.gutter.theme = theme;
		row.gutter.body = undefined;
		row.head = undefined;
		row.dot = dot(status, theme);

		const summary = toolName === "subagent" ? subagentSummary(args, theme) : describeTool(toolName, args, ctx.cwd, theme);
		if (summary !== undefined) {
			row.label = `${title(toolName, theme)}  ${summary}`;
			const command = str((args as any)?.command);
			if ((toolName === "bash" || toolName === "powershell") && ctx.expanded && command && firstLine(command).more > 0) {
				row.gutter.body = new Text(theme.fg("text", stripCd(command, ctx.cwd).trim()), 0, 0);
			}
			// The written content is a preview inside pi's write call component. Keep it as the body.
			if (toolName === "write" && base?.renderCall) {
				row.head = base.renderCall(args, theme, { ...ctx, lastComponent: st.wuBaseCall });
				st.wuBaseCall = row.head;
			}
		} else if (base?.renderCall) {
			row.label = "";
			row.head = base.renderCall(args, theme, { ...ctx, lastComponent: st.wuBaseCall });
			st.wuBaseCall = row.head;
		} else {
			const preview = previewArgs(args, theme);
			row.label = title(toolName, theme) + (preview ? `  ${preview}` : "");
		}

		const meta: string[] = [];
		if (st.wuInfo) meta.push(st.wuInfo);
		// HTML export draws every call as running and never finishes it. Skip a clock that has not ticked yet.
		const elapsed = st.wuStart === undefined ? undefined : (st.wuEnd ?? Date.now()) - st.wuStart;
		if (elapsed !== undefined && (st.wuEnd !== undefined || elapsed >= 1000)) meta.push(theme.fg("dim", formatDuration(elapsed)));
		row.meta = meta.join(theme.fg("dim", " · "));
		return row;
	};
}

function makeRenderResult(toolName: string, base: ToolRenderers | undefined): RenderResult {
	return (result, options, theme, ctx) => {
		const st = ctx.state as RowState;
		if (!options.isPartial || ctx.isError) {
			if (st.wuStart !== undefined) st.wuEnd ??= Date.now();
			stopTimer(st);
		}

		const gutter = ctx.lastComponent instanceof Gutter ? ctx.lastComponent : new Gutter(theme);
		gutter.theme = theme;
		if (toolName === "subagent" && isSubagentDetails(result.details)) {
			gutter.body = renderSubagentBody(result.details, options, theme, ctx.cwd);
		} else if (base?.renderResult) {
			gutter.body = base.renderResult(result, options, theme, { ...ctx, lastComponent: st.wuBaseResult });
			st.wuBaseResult = gutter.body;
		} else {
			gutter.body = fallbackBody(result, options, theme);
		}

		// Result facts go in the header, which pi drew before this result arrived. Redraw once, after this pass.
		const info = resultInfo(toolName, result, ctx.isError, options.isPartial, theme);
		if (info !== st.wuInfo) {
			st.wuInfo = info;
			queueMicrotask(() => ctx.invalidate());
		}
		return gutter;
	};
}

/** Restyle every tool row while isEnabled() is true. New rows pick up a change, existing rows keep their style. */
export function createToolResolver(isEnabled: () => boolean): ToolRendererResolver {
	return (toolName, next) => {
		const base = next();
		if (!isEnabled()) return base;
		return {
			renderShell: "self",
			renderCall: makeRenderCall(toolName, base),
			renderResult: makeRenderResult(toolName, base),
		};
	};
}
