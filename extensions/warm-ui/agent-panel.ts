/**
 * The agent panel: a persistent rounded box above the input with the latest user request's tools.
 *
 *   ╭────────────────────────────────────────────────────────────────────── [-] ─╮
 *   │ ● bash   sleep 5                                                   3s       │
 *   │   │ ✓ read  src/rate-limit.js                                      0.4s     │
 *   │ ✓ edit  src/rate-limit.js   +1 −1                                  0.2s     │
 *   ╰──────────────────────────────────────────────────────────────────────────────╯
 *
 * Collapsed, it keeps the top border only and shows how many calls the turn made:
 *
 *   ╭───────────────────────────────────────────────────── 󰚩 3  [+] ─╮
 *
 * The panel stays mounted while idle and keeps the last run's calls until the next run starts. Its
 * rainbow frame flows while the agent is busy and freezes when it settles. A click on the top
 * border toggles the fold. pi has no subagent entity, so the rows come from the tool events that
 * index.ts records; a call that another tool made (parentToolCallId) is indented one level.
 *
 * Width: a row gives up its argument summary first, then its duration, then it truncates the tool
 * name. Below AGENT_PANEL_MIN_WIDTH only the top border draws. The rainbow adapts to the theme's
 * light/dark appearance, and the content uses the status bar palette. The icon sets differ only in the
 * glyphs they draw.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { rgbColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { describeTool, previewArgs } from "./describe.ts";
import { firstLine, str } from "./format.ts";
import { fitFrameLines, frameWidth } from "./frame.ts";
import { type Icons, icons } from "./icons.ts";

/** Rows that an expanded panel shows, the "… +N more" line included. */
export const AGENT_PANEL_MAX_ROWS = 6;
/** Below this width only the top border draws. */
export const AGENT_PANEL_MIN_WIDTH = 30;
/** Columns that a tool name keeps before it is cut. */
const NAME_MIN = 4;

export type AgentStatus = "running" | "done" | "error" | "stopped";

/** One color step every 100 ms; four columns per color keeps ANSI traffic modest. */
export const AGENT_PANEL_FRAME_MS = 100;
const RAINBOW_CELL_WIDTH = 4;
const RAINBOW_DARK = [0xef7777, 0xefa45f, 0xe7cd66, 0x85c982, 0x72c7d1, 0x89a9ed, 0xc59ae8];
const RAINBOW_LIGHT = [0xb83245, 0xa75413, 0x806b00, 0x347638, 0x007783, 0x365eb1, 0x8746ad];
const rainbowColors = (values: number[]) => values.map((n) => rgbColor(n >> 16, (n >> 8) & 255, n & 255));
const RAINBOW = { dark: rainbowColors(RAINBOW_DARK), light: rainbowColors(RAINBOW_LIGHT) };

type BorderPaint = (text: string, x: number, y: number) => string;

/** Walk clockwise around the frame so corners and side edges share the same moving gradient. */
function rainbowBorder(input: AgentPanelInput, width: number, height: number): BorderPaint {
	const colors = RAINBOW[input.theme.appearance === "light" ? "light" : "dark"];
	const running = input.running ?? input.calls.some((call) => call.status === "running");
	const phase = input.borderPhase ?? (running ? Math.floor(input.now / AGENT_PANEL_FRAME_MS) : 0);
	return (text, x, y) => {
		let out = "";
		let run = "";
		let last = -1;
		const flush = () => {
			if (run) out += input.theme.style(run, { fg: colors[last] });
			run = "";
		};
		for (const char of text) {
			const at = y === 0 ? x : y === height - 1 ? width - 1 + height - 1 + width - 1 - x
				: x === width - 1 ? width - 1 + y : 2 * (width - 1) + height - 1 + height - 1 - y;
			const index = ((Math.floor(at / RAINBOW_CELL_WIDTH) + phase) % colors.length + colors.length) % colors.length;
			if (index !== last) {
				flush();
				last = index;
			}
			run += char;
			x++;
		}
		flush();
		return out;
	};
}

/** One tool call of the latest agent run. index.ts fills this from the tool events. */
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
	/** Calls of the latest agent run, in the order they started. */
	calls: readonly AgentCall[];
	collapsed: boolean;
	/** Milliseconds, for the live duration of a running call. */
	now: number;
	/** Busy for the whole agent run, including thinking and text streaming without tools. */
	running?: boolean;
	/** Frozen at settlement, so unrelated renders cannot move an idle border. */
	borderPhase?: number;
	theme: Theme;
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

const statusGlyph = (status: AgentStatus) => (status === "running" ? "●" : status === "error" ? "✗" : status === "stopped" ? "■" : "✓");

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
	if (status === "stopped") return (text) => theme.fg("warning", text);
	return (text) => theme.fg("success", text);
}

/** A clean top edge: only the right-aligned fold marker and, when collapsed, the call count. */
function topBorder(input: AgentPanelInput, width: number, border: BorderPaint): string {
	if (width === 1) return border("─", 0, 0);
	const { theme, ic, calls, collapsed } = input;
	const marker = collapsed ? "[+]" : "[-]";
	if (width < 9) return border("╭" + "─".repeat(width - 2) + "╮", 0, 0);

	const glyph = input.showAgentIcon && ic.subagents ? `${ic.subagents} ` : "";
	const count = collapsed ? theme.fg("muted", `${glyph}${calls.length}  `) : "";
	let right = count + theme.fg("muted", marker);
	// A narrow frame drops the count before it drops the fold control.
	if (visibleWidth(right) + 7 > width) right = theme.fg("muted", marker);
	const lead = width - visibleWidth(right) - 4;
	return border("╭" + "─".repeat(lead - 1), 0, 0) + ` ${right} ` + border("─╮", width - 2, 0);
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
	const width = frameWidth(input.width);
	if (!width) return [""];
	const compact = input.collapsed || width < AGENT_PANEL_MIN_WIDTH;
	const { shown, hidden } = pickRows(input.calls);
	const height = compact ? 1 : shown.length + (hidden ? 1 : 0) + 2;
	const border = rainbowBorder(input, width, height);
	const top = topBorder(input, width, border);
	if (compact) return fitFrameLines([top], width);

	const lines = [top];
	const row = (body: string) => {
		const y = lines.length;
		lines.push(border("│", 0, y) + " " + body + " " + border("│", width - 1, y));
	};
	// Each row fits on its own, so a long call never starves a short one.
	for (const call of shown) row(callRow(input, call, width));
	if (hidden > 0) {
		const text = input.theme.fg("dim", `… +${hidden} more`);
		row(text + " ".repeat(Math.max(0, width - 4 - visibleWidth(text))));
	}
	lines.push(border("╰" + "─".repeat(width - 2) + "╯", 0, height - 1));
	return fitFrameLines(lines, width);
}

/** The state that the panel renders. index.ts feeds it from the tool events. */
export interface AgentPanelStore {
	calls: Map<string, AgentCall>;
	collapsed: boolean;
	/** Start a user request; retain calls across its model turns and tool batches. */
	begin(now: number): void;
	/** Freeze the frame and finish interrupted tools without reporting false success. */
	settle(now: number): void;
	phase(now: number): number;
	start(event: { toolCallId: string; toolName: string; args: any; parentToolCallId?: string }, cwd: string, now: number): void;
	end(event: { toolCallId: string; isError: boolean; durationMs?: number }, now: number): void;
	clear(): void;
	running(): boolean;
	/** Number of calls in the latest agent run. */
	size(): number;
	/** Calls in start order, with the duration of a finished call filled in. */
	list(): AgentCall[];
}

export function createAgentPanelStore(): AgentPanelStore {
	const calls = new Map<string, AgentCall>();
	let active = false;
	let frozenPhase = 0;
	const store: AgentPanelStore = {
		calls,
		collapsed: false,
		begin(_now) {
			// Automatic continuation can start another agent cycle before final settlement.
			if (!active) calls.clear();
			active = true;
		},
		settle(now) {
			frozenPhase = store.phase(now);
			active = false;
			for (const call of calls.values()) {
				if (call.status !== "running") continue;
				call.status = "stopped";
				call.durationMs = Math.max(0, now - call.startedAt);
			}
		},
		phase(now) {
			return store.running() ? Math.floor(now / AGENT_PANEL_FRAME_MS) : frozenPhase;
		},
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
			active = false;
			frozenPhase = 0;
		},
		running() {
			return active || [...calls.values()].some((call) => call.status === "running");
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
	/** Give the owner a redraw callback instead of replacing the widget on every tool event. */
	onRender?: (request: () => void) => void;
}

/**
 * The widget factory for ctx.ui.setWidget. The component keeps no state of its own, so pi may call
 * it again after a reload; the store and the collapsed flag live outside it.
 */
export function createAgentPanel(deps: AgentPanelDeps): (tui: TUI, theme: Theme) => Component {
	return (tui, theme) => {
		deps.onRender?.(() => tui.requestRender());
		// Idle ticks do not redraw; model thinking and streaming animate even without a running tool.
		const timer = setInterval(() => {
			if (deps.store.running()) tui.requestRender();
		}, AGENT_PANEL_FRAME_MS);
		timer.unref?.();
		return {
			render(width: number): string[] {
				const now = Date.now();
				return renderAgentPanel({
					width,
					calls: deps.store.list(),
					collapsed: deps.store.collapsed,
					now,
					running: deps.store.running(),
					borderPhase: deps.store.phase(now),
					theme,
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
				deps.onRender?.(() => {});
			},
		};
	};
}
