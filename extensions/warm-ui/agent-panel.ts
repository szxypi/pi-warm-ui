/**
 * The agent panel: a rounded box above the input that lists the tool calls of the current turn.
 *
 *   ╭─ ● main  glm-5.3 · max ──────────────────────────────────────────────── [-] ─╮
 *   │ ● bash   sleep 5                                                   3s       │
 *   │   │ ✓ read  src/rate-limit.js                                      0.4s     │
 *   │ ✓ edit  src/rate-limit.js   +1 −1                                  0.2s     │
 *   ╰──────────────────────────────────────────────────────────────────────────────╯
 *
 * Collapsed, it keeps the top border only and shows how many calls the turn made:
 *
 *   ╭─ ● main  glm-5.3 · max ─────────────────────────────── 󰚩 3  [+] ─╮
 *
 * The panel mounts on the first tool call and goes away at the end of the turn. A click on the top
 * border toggles the fold. pi has no subagent entity, so the rows come from the tool events that
 * index.ts records; a call that another tool made (parentToolCallId) is indented one level.
 *
 * Width: a row gives up its argument summary first, then its duration, then it truncates the tool
 * name. Below AGENT_PANEL_MIN_WIDTH only the top border draws. The box takes its colors from the
 * theme and the status bar palette, so all five themes work, and the icon sets differ only in the
 * glyphs they draw.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { describeTool, previewArgs } from "./describe.ts";
import { firstLine, str } from "./format.ts";
import { type Icons, icons } from "./icons.ts";
import { type Palette, paletteFor } from "./palette.ts";

/** Rows that an expanded panel shows, the "… +N more" line included. */
export const AGENT_PANEL_MAX_ROWS = 6;
/** Below this width only the top border draws. */
export const AGENT_PANEL_MIN_WIDTH = 30;
/** Columns that a tool name keeps before it is cut. */
const NAME_MIN = 4;

export type AgentStatus = "running" | "done" | "error";

/** One tool call of the current turn. index.ts fills this from the tool events. */
export interface AgentCall {
	id: string;
	name: string;
	args: any;
	/** Working directory when the call started. Kept here, so a render never reads the extension context. */
	cwd: string;
	/** Set when another tool made this call. */
	parentId?: string;
	status: AgentStatus;
	startedAt: number;
	/** Final duration in milliseconds, set when the call ends. */
	durationMs?: number;
}

export interface AgentPanelInput {
	/** Terminal width. Every returned line is exactly this wide. */
	width: number;
	/** Calls of the current turn, in the order they started. */
	calls: readonly AgentCall[];
	collapsed: boolean;
	/** Current model id, or "" when pi reports none. */
	model: string;
	/** Current thinking level, or undefined when the model does not think or the level is "off". */
	effort: string | undefined;
	/** Milliseconds, for the live duration of a running call. */
	now: number;
	theme: Theme;
	pal: Palette;
	ic: Icons;
	/** The "none" icon set draws no agent glyph. */
	showAgentIcon: boolean;
}

/**
 * "0.4s", "3s", "1m20s", "1h02m". Below a second it keeps one decimal, so a fast call does not read
 * as "0s". Above that it rounds down, so a running call never shows a time it has not reached.
 */
export function agentDuration(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 1000) return `${(Math.round(safe / 100) / 10).toFixed(1)}s`;
	const s = Math.floor(safe / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

const statusGlyph = (status: AgentStatus) => (status === "running" ? "●" : status === "error" ? "✗" : "✓");

/**
 * The label and the plain summary of a call. A subagent call shows its agent name and its task
 * instead of the raw arguments.
 */
function describeCall(call: AgentCall, theme: Theme): { label: string; summary: string } {
	if (call.name === "subagent") {
		const args = call.args ?? {};
		const tasks = Array.isArray(args.tasks) ? args.tasks : [];
		const label =
			str(args.agent) ?? str(tasks[0]?.agent) ?? (Array.isArray(args.chain) && args.chain.length > 0 ? str(args.chain[0]?.agent) : undefined) ?? "subagent";
		const task = str(args.task) ?? str(tasks[0]?.task) ?? (Array.isArray(args.tasks) && tasks.length > 1 ? `${tasks.length} tasks` : undefined);
		return { label, summary: task ? firstLine(task).line : "" };
	}
	const known = describeTool(call.name, call.args, call.cwd, theme);
	return { label: call.name, summary: known ?? previewArgs(call.args, theme) };
}

/** The paint of one call's status dot. Running is the warm accent, like the tool rows use. */
function dotPaint(status: AgentStatus, theme: Theme): (text: string) => string {
	if (status === "running") return (text) => theme.fg("accent", text);
	if (status === "error") return (text) => theme.fg("error", text);
	return (text) => theme.fg("success", text);
}

/**
 * The top border: the status dot and "main" with the model and the level, then the fold marker. The
 * call count sits next to the marker when the panel is collapsed. When the width is tight the border
 * drops the level, then the model, so the marker and the fill always fit.
 */
function topBorder(input: AgentPanelInput, width: number): string {
	const { theme, pal, ic, calls, collapsed, model, effort } = input;
	const running = calls.some((call) => call.status === "running");
	const paint = (text: string) => theme.fg("borderMuted", text);
	const dot = dotPaint(running ? "running" : "done", theme)("●");
	const main = theme.style(" main", { fg: pal.model, bold: true });

	const count: string[] = [];
	if (collapsed) {
		const glyph = input.showAgentIcon && ic.subagents ? `${ic.subagents} ` : "";
		count.push(theme.fg("muted", `${glyph}${calls.length}`));
	}
	count.push(theme.fg("muted", collapsed ? "[+]" : "[-]"));
	const rightText = count.join(theme.fg("dim", "  "));
	const rightW = visibleWidth(rightText) + 2;

	// The left group gives up the level first, then the model.
	const names = [model && effort ? `${model} · ${effort}` : model, model, ""];
	for (const name of names) {
		const glyph = name && ic.model ? `${ic.model} ` : "";
		const leftText = dot + main + (name ? theme.fg("muted", `  ${glyph}${name}`) : "");
		const fill = width - 4 - (visibleWidth(leftText) + 2) - rightW;
		if (fill >= 0) {
			return paint("╭─") + ` ${leftText} ` + paint("─".repeat(fill)) + ` ${rightText} ` + paint("─╮");
		}
	}
	// Even the bare "● main" does not fit next to the marker. Keep the marker and cut the left group.
	const leftText = truncateToWidth(dot + main, Math.max(0, width - 4 - rightW), "…");
	const fill = width - 4 - visibleWidth(leftText) - 2 - rightW;
	return (
		paint("╭─") +
		(leftText ? ` ${leftText} ` : paint("─")) +
		paint("─".repeat(Math.max(0, fill))) +
		` ${rightText} ` +
		paint("─╮")
	);
}

/** The fixed parts of one row: the tree prefix, the status glyph and the agent glyph. */
function rowHead(input: AgentPanelInput, call: AgentCall): { text: string; width: number } {
	const { theme, ic } = input;
	const indent = call.parentId ? theme.fg("borderMuted", "│ ") : "";
	const dot = dotPaint(call.status, theme)(statusGlyph(call.status));
	const agentGlyph = call.name === "subagent" && input.showAgentIcon && ic.subagents ? `${ic.subagents} ` : "";
	const text = `${indent}${dot} ${agentGlyph}`;
	return { text, width: visibleWidth(text) };
}

/**
 * One call row, fitted to the content width. It gives up its argument summary first, then its
 * duration, then the tool name is cut. A row that still does not fit drops its summary and duration.
 */
function callRow(input: AgentPanelInput, call: AgentCall, width: number): string {
	const { theme } = input;
	// The border takes one column on each side and one blank column follows it, so the row body spans
	// width - 4 columns: "│" + " " + body + " " + "│".
	const contentW = Math.max(0, width - 4);
	const head = rowHead(input, call);
	const { label, summary } = describeCall(call, theme);
	const namePaint = (text: string) => theme.style(text, { fg: "syntaxType", bold: true });
	const duration = agentDuration(call.durationMs ?? Math.max(0, input.now - call.startedAt));

	// Rung 1: everything. Two blank columns precede the summary and two precede the duration.
	const all = head.width + visibleWidth(label) + 2 + visibleWidth(summary) + 2 + visibleWidth(duration);
	if (all <= contentW) {
		return head.text + namePaint(label) + `  ${summary}` + " ".repeat(contentW - all) + "  " + theme.fg("dim", duration);
	}
	// Rung 2: summary dropped, duration kept, name cut to the room that is left.
	const durW = visibleWidth(duration) + 2;
	if (head.width + NAME_MIN + durW <= contentW) {
		const name = truncateToWidth(label, contentW - head.width - durW, "…");
		const used = head.width + visibleWidth(name);
		return head.text + namePaint(name) + " ".repeat(Math.max(0, contentW - used - durW)) + "  " + theme.fg("dim", duration);
	}
	// Rung 3: duration dropped too. The name takes what is left.
	const name = truncateToWidth(label, Math.max(1, contentW - head.width), "…");
	return head.text + namePaint(name) + " ".repeat(Math.max(0, contentW - head.width - visibleWidth(name)));
}

/**
 * Keep the running calls first, then the most recent of the rest. The panel shows at most
 * AGENT_PANEL_MAX_ROWS rows: when calls are hidden, the last row becomes the "… +N more" line.
 */
function pickRows(calls: readonly AgentCall[]): { shown: AgentCall[]; hidden: number } {
	if (calls.length <= AGENT_PANEL_MAX_ROWS) return { shown: [...calls], hidden: 0 };
	// One row is the "… +N more" line.
	const keep = AGENT_PANEL_MAX_ROWS - 1;
	const indexed = calls.map((call, order) => ({ call, order }));
	const running = indexed.filter(({ call }) => call.status === "running");
	const rest = indexed.filter(({ call }) => call.status !== "running");
	const picked = running.slice(0, keep);
	const room = keep - picked.length;
	if (room > 0) picked.push(...rest.slice(-room));
	picked.sort((a, b) => a.order - b.order);
	return { shown: picked.map(({ call }) => call), hidden: calls.length - picked.length };
}

/** Draw the panel. Every line is exactly `input.width` columns. */
export function renderAgentPanel(input: AgentPanelInput): string[] {
	const width = Math.floor(input.width);
	if (!(width > 0)) return [""];
	if (width < AGENT_PANEL_MIN_WIDTH) return [topBorder(input, width)];

	const top = topBorder(input, width);
	if (input.collapsed) return [top];

	const { shown, hidden } = pickRows(input.calls);
	const border = (text: string) => input.theme.fg("borderMuted", text);
	const lines = [top];
	// Each row fits on its own, so a long call never starves a short one.
	for (const call of shown) lines.push(border("│") + " " + callRow(input, call, width) + " " + border("│"));
	if (hidden > 0) {
		const text = input.theme.fg("dim", `… +${hidden} more`);
		lines.push(border("│") + " " + text + " ".repeat(Math.max(0, width - 4 - visibleWidth(text))) + " " + border("│"));
	}
	lines.push(border("╰") + border("─".repeat(Math.max(0, width - 2))) + border("╯"));
	return lines;
}

/** The state that the panel renders. index.ts feeds it from the tool events. */
export interface AgentPanelStore {
	calls: Map<string, AgentCall>;
	collapsed: boolean;
	start(event: { toolCallId: string; toolName: string; args: any; parentToolCallId?: string }, cwd: string, now: number): void;
	end(event: { toolCallId: string; isError: boolean; durationMs?: number }, now: number): void;
	clear(): void;
	running(): boolean;
	/** Number of calls in the current turn. */
	size(): number;
	/** Calls in start order, with the duration of a finished call filled in. */
	list(): AgentCall[];
}

export function createAgentPanelStore(): AgentPanelStore {
	const calls = new Map<string, AgentCall>();
	const store: AgentPanelStore = {
		calls,
		collapsed: false,
		start(event, cwd, now) {
			calls.set(event.toolCallId, {
				id: event.toolCallId,
				name: event.toolName,
				args: event.args,
				cwd,
				parentId: event.parentToolCallId,
				status: "running",
				startedAt: now,
			});
		},
		end(event, now) {
			const call = calls.get(event.toolCallId);
			if (!call) return;
			call.status = event.isError ? "error" : "done";
			call.durationMs = event.durationMs ?? Math.max(0, now - call.startedAt);
		},
		clear() {
			calls.clear();
		},
		running() {
			return [...calls.values()].some((call) => call.status === "running");
		},
		size() {
			return calls.size;
		},
		list() {
			return [...calls.values()];
		},
	};
	return store;
}

export interface AgentPanelDeps {
	store: AgentPanelStore;
	config: Config;
	/** Current model and thinking level, read from the live context. */
	model: () => { model: string; effort: string | undefined };
}

/**
 * The widget factory for ctx.ui.setWidget. The component keeps no state of its own, so pi may call
 * it again after a reload; the store and the collapsed flag live outside it.
 */
export function createAgentPanel(deps: AgentPanelDeps): (tui: TUI, theme: Theme) => Component {
	return (tui, theme) => {
		// A running call ticks once a second, so its duration keeps up without new events.
		const timer = setInterval(() => {
			if (deps.store.running()) tui.requestRender();
		}, 1000);
		return {
			render(width: number): string[] {
				const { model, effort } = deps.model();
				return renderAgentPanel({
					width,
					calls: deps.store.list(),
					collapsed: deps.store.collapsed,
					model,
					effort,
					now: Date.now(),
					theme,
					// pi hands the factory a theme proxy, so this follows a theme switch on the next frame.
					pal: paletteFor(theme),
					ic: icons(deps.config.icons),
					showAgentIcon: deps.config.icons !== "none",
				});
			},
			handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
				// The whole top border toggles. The [-]/[+] mark is a label, not its own hit area.
				if (event.type !== "click" || event.y !== 0) return undefined;
				deps.store.collapsed = !deps.store.collapsed;
				tui.requestRender();
				return { handled: true, render: true };
			},
			invalidate() {},
			dispose() {
				clearInterval(timer);
			},
		};
	};
}
