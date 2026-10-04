/**
 * Subagent runs (pi-code's "subagent" tool and tools with the same result shape).
 *
 * Collapsed, single run:
 *   ✓ scout · minimax-m3                       3 turns · 4 tools · ↑12k ↓1.1k
 *     → read src/rate-limit.js
 *     → grep /limit/ in src
 *     The limiter allows one extra request…
 *
 * Collapsed, parallel or chain: one row per run, with the latest tool call under a running row.
 * Expanded: every run with its task, all tool calls and the final output as Markdown.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, keyHint } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Container, Markdown, Spacer, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { describeTool, previewArgs } from "./describe.ts";
import { formatTokens, spread, str } from "./format.ts";

interface Usage {
	input?: number;
	output?: number;
	cost?: number;
	turns?: number;
}

interface Run {
	agent: string;
	agentSource?: string;
	task?: string;
	exitCode: number;
	messages: any[];
	usage?: Usage;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	partial?: boolean;
}

interface Details {
	mode: "single" | "parallel" | "chain";
	results: Run[];
}

interface Options {
	expanded: boolean;
	isPartial: boolean;
}

type RunState = "running" | "ok" | "failed" | "partial";

const COLLAPSED_CALLS = 4;
const COLLAPSED_OUTPUT_LINES = 3;

export function isSubagentDetails(value: unknown): value is Details {
	const d = value as Details | undefined;
	return (
		!!d &&
		(d.mode === "single" || d.mode === "parallel" || d.mode === "chain") &&
		Array.isArray(d.results) &&
		d.results.length > 0 &&
		d.results.every((r) => !!r && typeof r.agent === "string" && Array.isArray(r.messages))
	);
}

function oneLine(text: unknown, max = 200): string {
	const s = (str(text) ?? "").replace(/\s+/g, " ").trim();
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The header summary after "subagent". */
export function subagentSummary(args: any, theme: Theme): string {
	if (args?.status) return theme.fg("text", "status");
	if (str(args?.cancel)) return theme.fg("text", "cancel ") + theme.fg("dim", args.cancel);
	if (str(args?.resume)) return theme.fg("text", "resume ") + theme.fg("dim", `${args.resume}  ${oneLine(args.task)}`);
	if (Array.isArray(args?.chain) && args.chain.length > 0) {
		const agents = args.chain.map((s: any) => str(s?.agent) ?? "?").join(" → ");
		return theme.fg("text", `chain · ${args.chain.length} steps`) + theme.fg("dim", `  ${agents}`);
	}
	if (Array.isArray(args?.tasks) && args.tasks.length > 0) {
		const agents = args.tasks.map((t: any) => str(t?.agent) ?? "?").join(", ");
		return theme.fg("text", `parallel · ${args.tasks.length} tasks`) + theme.fg("dim", `  ${agents}`);
	}
	let text = theme.fg("text", str(args?.agent) ?? "…");
	if (args?.background) text += theme.fg("dim", " · background");
	const task = oneLine(args?.task);
	return task ? `${text}${theme.fg("dim", `  ${task}`)}` : text;
}

function stateOf(r: Run, running: boolean): RunState {
	if (running) return "running";
	if ((r.exitCode !== 0 && r.exitCode !== -1) || r.stopReason === "error" || r.stopReason === "aborted") return "failed";
	return r.partial ? "partial" : "ok";
}

function icon(state: RunState, theme: Theme): string {
	if (state === "running") return theme.fg("accent", "◐");
	if (state === "failed") return theme.fg("error", "✗");
	if (state === "partial") return theme.fg("warning", "◑");
	return theme.fg("success", "✓");
}

function toolCalls(r: Run): { name: string; args: unknown }[] {
	const calls: { name: string; args: unknown }[] = [];
	for (const m of r.messages) {
		if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
		for (const part of m.content) {
			if (part?.type === "toolCall") calls.push({ name: String(part.name), args: part.arguments });
		}
	}
	return calls;
}

function finalOutput(r: Run): string {
	for (let i = r.messages.length - 1; i >= 0; i--) {
		const m = r.messages[i];
		if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
		const text = m.content
			.filter((part: any) => part?.type === "text")
			.map((part: any) => part.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return "";
}

function stats(usage: Usage | undefined, calls: number, running: boolean, theme: Theme): string {
	const u = usage ?? {};
	const parts: string[] = [];
	if (running) parts.push("running");
	if (u.turns) parts.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
	if (calls) parts.push(`${calls} tool${calls > 1 ? "s" : ""}`);
	if (u.input || u.output) parts.push(`↑${formatTokens(u.input ?? 0)} ↓${formatTokens(u.output ?? 0)}`);
	if (u.cost) parts.push(`$${u.cost.toFixed(3)}`);
	return theme.fg("dim", parts.join(" · "));
}

/** A component that builds its lines for the current width. */
class Lines implements Component {
	constructor(private readonly build: (width: number) => string[]) {}
	render(width: number): string[] {
		return this.build(width);
	}
	invalidate(): void {}
}

/** Nested tool calls read one step quieter than top-level rows. */
function quiet(theme: Theme): Theme {
	return Object.create(theme, {
		fg: { value: (color: Parameters<Theme["fg"]>[0], text: string) => theme.fg(color === "text" ? "muted" : color, text) },
	});
}

function callLine(call: { name: string; args: unknown }, cwd: string, theme: Theme): string {
	const q = quiet(theme);
	const summary = describeTool(call.name, call.args, cwd, q) ?? previewArgs(call.args, theme);
	return `${theme.fg("dim", "→")} ${theme.fg("muted", call.name)}${summary ? ` ${summary}` : ""}`;
}

/** Plain text for one-line previews: no emphasis, code or heading markers. */
function plain(line: string): string {
	return line.replace(/^#{1,6}\s+/, "").replace(/\*\*|__|`/g, "");
}

function wrapIndented(text: string, width: number, indent: string): string[] {
	return wrapTextWithAnsi(text, Math.max(1, width - visibleWidth(indent))).map((line) => indent + line);
}

export function renderSubagentBody(details: Details, options: Options, theme: Theme, cwd: string): Component {
	const runs = details.results;
	const last = runs.length - 1;
	const running = (r: Run, i: number) =>
		r.exitCode === -1 || (options.isPartial && (details.mode === "single" || (details.mode === "chain" && i === last)));
	const anyRunning = runs.some(running);
	const multi = details.mode !== "single" || runs.length > 1;
	const step = (r: Run, i: number) => (details.mode === "chain" ? theme.fg("dim", `${r.step ?? i + 1} `) : "");
	const container = new Container();
	let hidden = false;

	if (multi && !options.expanded) {
		// One row per run. Running rows show their latest tool call underneath.
		const nameWidth = Math.max(...runs.map((r) => visibleWidth(r.agent)));
		container.addChild(
			new Lines((width) => {
				const lines: string[] = [];
				runs.forEach((r, i) => {
					const isRunning = running(r, i);
					const state = stateOf(r, isRunning);
					const calls = toolCalls(r);
					const name = theme.fg("text", r.agent + " ".repeat(nameWidth - visibleWidth(r.agent)));
					const left = `${step(r, i)}${icon(state, theme)} ${name}  ${theme.fg("dim", oneLine(r.task))}`;
					const right =
						state === "failed" && r.errorMessage
							? theme.fg("error", oneLine(r.errorMessage, 48))
							: stats(r.usage, calls.length, isRunning, theme);
					lines.push(spread(left, right, width));
					const latest = calls[calls.length - 1];
					if (isRunning && latest) lines.push(...wrapIndented(callLine(latest, cwd, theme), width, "    ").slice(0, 1));
				});
				return lines;
			}),
		);
		hidden = true;
	} else {
		runs.forEach((r, i) => {
			if (i > 0) container.addChild(new Spacer(1));
			const isRunning = running(r, i);
			const state = stateOf(r, isRunning);
			const calls = toolCalls(r);
			const output = finalOutput(r);
			const model = r.model?.split("/").pop();
			const shownCalls = options.expanded ? calls : calls.slice(-COLLAPSED_CALLS);
			if (shownCalls.length < calls.length) hidden = true;

			container.addChild(
				new Lines((width) => {
					let head = `${step(r, i)}${icon(state, theme)} ${theme.bold(theme.fg("text", r.agent))}`;
					if (model) head += theme.fg("dim", ` · ${model}`);
					if (options.expanded && r.agentSource) head += theme.fg("dim", ` · ${r.agentSource}`);
					const lines = [spread(head, stats(r.usage, calls.length, isRunning, theme), width)];
					// A single collapsed run already shows its task in the row header.
					if (r.task && (multi || options.expanded)) {
						lines.push(...wrapIndented(theme.fg("dim", options.expanded ? r.task.trim() : oneLine(r.task)), width, "  "));
					}
					if (state === "failed" && r.errorMessage) lines.push(...wrapIndented(theme.fg("error", r.errorMessage), width, "  "));
					if (shownCalls.length < calls.length) {
						lines.push(theme.fg("dim", `  … ${calls.length - shownCalls.length} earlier tool calls`));
					}
					for (const call of shownCalls) lines.push(...wrapIndented(callLine(call, cwd, theme), width, "  ").slice(0, 1));
					return lines;
				}),
			);

			if (!output) return;
			if (options.expanded) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(output, 2, 0, getMarkdownTheme()));
				return;
			}
			const outLines = output.split("\n").filter((line) => line.trim());
			if (outLines.length > COLLAPSED_OUTPUT_LINES) hidden = true;
			container.addChild(
				new Lines((width) =>
					outLines
						.slice(0, COLLAPSED_OUTPUT_LINES)
						.flatMap((line) => wrapIndented(theme.fg("toolOutput", plain(line)), width, "  ").slice(0, 1)),
				),
			);
		});
	}

	if (multi && !anyRunning) {
		const total: Usage = { input: 0, output: 0, cost: 0, turns: 0 };
		let calls = 0;
		for (const r of runs) {
			total.input! += r.usage?.input ?? 0;
			total.output! += r.usage?.output ?? 0;
			total.cost! += r.usage?.cost ?? 0;
			total.turns! += r.usage?.turns ?? 0;
			calls += toolCalls(r).length;
		}
		container.addChild(new Lines(() => [theme.fg("dim", "total  ") + stats(total, calls, false, theme)]));
	}
	if (hidden && !options.expanded) container.addChild(new Lines(() => [keyHint("app.tools.expand", "to expand")]));
	return container;
}
