/**
 * Persistent agent roster above the input. The header stays clean; main is always a body row.
 *
 *   ╭──────────────────────────────────────────────────────────────────── [-] ─╮
 *   │ ● main      GPT 6.1 SOL · XHIGH                                         │
 *   │ ● scout     MINIMAX M3 · HIGH                                           │
 *   │ └─ ✓ coder  DEEPSEEK FLASH · MAX                                        │
 *   ╰─────────────────────────────────────────────────────────────────────────╯
 *
 * Ordinary tools are not agents. Child rows come from subagent snapshots and native async events;
 * the frame animates during the main run or background children, and freezes once all are idle.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { rgbColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { AGENT_PANEL_FRAME_MS, displayModel, type AgentPanelStore, type AgentStatus, type PanelAgent } from "./agent-roster.ts";
import { fitFrameLines, frameWidth } from "./frame.ts";
import { type Icons, icons } from "./icons.ts";

export { AGENT_PANEL_FRAME_MS, createAgentPanelStore, displayModel } from "./agent-roster.ts";
export type { AgentPanelStore, AgentStatus, PanelAgent } from "./agent-roster.ts";
/** Total body rows, including main and an optional '… +N more' row. */
export const AGENT_PANEL_MAX_ROWS = 6;
/** Below this width retain main, but omit children. */
export const AGENT_PANEL_MIN_WIDTH = 30;
const RAINBOW_CELL_WIDTH = 4;
const rainbowColors = (values: number[]) => values.map((n) => rgbColor(n >> 16, (n >> 8) & 255, n & 255));
const RAINBOW = {
	dark: rainbowColors([0xef7777, 0xefa45f, 0xe7cd66, 0x85c982, 0x72c7d1, 0x89a9ed, 0xc59ae8]),
	light: rainbowColors([0xb83245, 0xa75413, 0x806b00, 0x347638, 0x007783, 0x365eb1, 0x8746ad]),
};
type BorderPaint = (text: string, x: number, y: number) => string;
export interface AgentPanelInput {
	width: number;
	main: PanelAgent;
	agents: readonly PanelAgent[];
	collapsed: boolean;
	now: number;
	running: boolean;
	borderPhase?: number;
	theme: Theme;
	ic: Icons;
	showAgentIcon: boolean;
}

/** Clockwise frame coordinates keep the gradient continuous around the corners. */
function rainbowBorder(input: AgentPanelInput, width: number, height: number): BorderPaint {
	const colors = RAINBOW[input.theme.appearance === "light" ? "light" : "dark"];
	const phase = input.borderPhase ?? (input.running ? Math.floor(input.now / AGENT_PANEL_FRAME_MS) : 0);
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
			if (index !== last) { flush(); last = index; }
			run += char;
			x++;
		}
		flush();
		return out;
	};
}

/** Only the right-aligned fold control lives in the header; the count includes main. */
function topBorder(input: AgentPanelInput, width: number, border: BorderPaint): string {
	if (width === 1) return border("─", 0, 0);
	if (width < 9) return border("╭" + "─".repeat(width - 2) + "╮", 0, 0);
	const { theme, ic } = input;
	const glyph = input.showAgentIcon && ic.subagents ? `${ic.subagents} ` : "";
	const marker = input.collapsed ? "[+]" : "[-]";
	let right = theme.fg("muted", (input.collapsed ? `${glyph}${input.agents.length + 1}  ` : "") + marker);
	if (visibleWidth(right) + 7 > width) right = theme.fg("muted", marker);
	const lead = width - visibleWidth(right) - 4;
	return border("╭" + "─".repeat(lead - 1), 0, 0) + ` ${right} ` + border("─╮", width - 2, 0);
}
function statusMark(status: AgentStatus, theme: Theme): string {
	if (status === "error") return theme.fg("error", "✗");
	if (status === "stopped") return theme.fg("warning", "■");
	if (status === "done") return theme.fg("success", "✓");
	if (status === "pending") return theme.fg("dim", "◌");
	return theme.fg(status === "running" ? "accent" : "dim", "●");
}
function agentRow(input: AgentPanelInput, agent: PanelAgent, tree: string, width: number): string {
	const { theme } = input;
	const room = Math.max(0, width - 4);
	const prefix = theme.fg("borderMuted", tree) + statusMark(agent.status, theme) + " ";
	const nameRoom = Math.max(1, Math.min(24, room - visibleWidth(prefix) - 4));
	const name = theme.style(truncateToWidth(agent.name, nameRoom, "…"), { fg: "syntaxType", bold: true });
	const model = displayModel(agent.model);
	const effort = agent.effort ? ` · ${agent.effort.toUpperCase()}` : "";
	let details = model + effort;
	const left = prefix + name;
	const rest = room - visibleWidth(left) - 2;
	if (rest < visibleWidth(details)) {
		// Preserve the effort when possible; cut the model before clipping the complete row.
		const modelRoom = rest - visibleWidth(effort);
		details = modelRoom >= 4 ? truncateToWidth(model, modelRoom, "…") + effort : truncateToWidth(model, Math.max(0, rest), "…");
	}
	let line = left + (details ? "  " + theme.fg("muted", details) : "");
	line = truncateToWidth(line, room, "…");
	return line + " ".repeat(Math.max(0, room - visibleWidth(line)));
}
function treeOrder(agents: readonly PanelAgent[]): PanelAgent[] {
	const map = new Map(agents.map((agent) => [agent.id, agent]));
	const out: PanelAgent[] = [];
	const children = new Map<string, PanelAgent[]>();
	for (const agent of agents) if (agent.parentId) {
		const siblings = children.get(agent.parentId) ?? [];
		siblings.push(agent);
		children.set(agent.parentId, siblings);
	}
	const seen = new Set<string>();
	const visit = (agent: PanelAgent) => {
		if (seen.has(agent.id)) return;
		seen.add(agent.id);
		out.push(agent);
		for (const child of children.get(agent.id) ?? []) visit(child);
	};
	for (const agent of agents) if (!agent.parentId || !map.has(agent.parentId)) visit(agent);
	for (const agent of agents) visit(agent);
	return out;
}
function treePrefix(agent: PanelAgent, agents: PanelAgent[]): string {
	const map = new Map(agents.map((row) => [row.id, row]));
	const chain: PanelAgent[] = [];
	const seen = new Set<string>();
	let current = agent;
	while (current.parentId && map.has(current.parentId) && !seen.has(current.id)) {
		seen.add(current.id);
		chain.unshift(current);
		current = map.get(current.parentId)!;
	}
	const hasNext = (row: PanelAgent) => {
		const siblings = agents.filter((other) => other.parentId === row.parentId);
		return siblings[siblings.length - 1]?.id !== row.id;
	};
	return chain.map((row, index) => index === chain.length - 1 ? (hasNext(row) ? "├─ " : "└─ ") : (hasNext(row) ? "│  " : "   ")).join("");
}
function pickRows(agents: readonly PanelAgent[]): { shown: PanelAgent[]; hidden: number } {
	const ordered = treeOrder(agents);
	const available = AGENT_PANEL_MAX_ROWS - 1; // main is never removed.
	if (ordered.length <= available) return { shown: ordered, hidden: 0 };
	const keep = available - 1;
	const map = new Map(ordered.map((agent) => [agent.id, agent]));
	const picked = new Set<string>();
	const active = ordered.filter((agent) => agent.status === "running" || agent.status === "pending");
	const rest = ordered.filter((agent) => agent.status !== "running" && agent.status !== "pending").reverse();
	for (const agent of [...active, ...rest]) {
		const family = new Set([agent.id]);
		let parent = agent.parentId;
		while (parent && map.has(parent) && !family.has(parent)) {
			family.add(parent);
			parent = map.get(parent)?.parentId;
		}
		if (new Set([...picked, ...family]).size > keep) continue;
		for (const id of family) picked.add(id);
	}
	const shown = ordered.filter((agent) => picked.has(agent.id));
	return { shown, hidden: ordered.length - shown.length };
}
export function renderAgentPanel(input: AgentPanelInput): string[] {
	const width = frameWidth(input.width);
	if (!width) return [""];
	const compact = input.collapsed || width < 8;
	const { shown, hidden } = width < AGENT_PANEL_MIN_WIDTH ? { shown: [], hidden: 0 } : pickRows(input.agents);
	const height = compact ? 1 : shown.length + (hidden ? 1 : 0) + 3;
	const border = rainbowBorder(input, width, height);
	const lines = [topBorder(input, width, border)];
	if (compact) return fitFrameLines(lines, width);
	const row = (body: string) => {
		const y = lines.length;
		lines.push(border("│", 0, y) + " " + body + " " + border("│", width - 1, y));
	};
	row(agentRow(input, input.main, "", width));
	for (const agent of shown) row(agentRow(input, agent, treePrefix(agent, shown), width));
	if (hidden) {
		const text = input.theme.fg("dim", `… +${hidden} more`);
		row(text + " ".repeat(Math.max(0, width - 4 - visibleWidth(text))));
	}
	lines.push(border("╰" + "─".repeat(width - 2) + "╯", 0, height - 1));
	return fitFrameLines(lines, width);
}
export interface AgentPanelDeps {
	store: AgentPanelStore;
	config: Config;
	/** Read only while this session's widget is mounted; the owner clears its live context on shutdown. */
	model: () => { model?: string; effort?: string };
	onRender?: (request: () => void) => void;
}
export function createAgentPanel(deps: AgentPanelDeps): (tui: TUI, theme: Theme) => Component {
	return (tui, theme) => {
		let disposed = false;
		let lastPoll = 0;
		deps.onRender?.(() => tui.requestRender());
		const timer = setInterval(() => {
			if (deps.store.running()) tui.requestRender();
			// Background children publish their actual models/thinking/state to status.json.
			const now = Date.now();
			if (now - lastPoll >= 1000) {
				lastPoll = now;
				void deps.store.refresh().then((changed) => { if (changed && !disposed) tui.requestRender(); });
			}
		}, AGENT_PANEL_FRAME_MS);
		timer.unref?.();
		return {
			render(width: number): string[] {
				const now = Date.now();
				return renderAgentPanel({
					width,
					main: { id: "main", name: "main", ...deps.model(), status: deps.store.mainStatus() },
					agents: deps.store.list(),
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
				if (event.type !== "click" || event.y !== 0) return undefined;
				deps.store.collapsed = !deps.store.collapsed;
				tui.requestRender();
				return { handled: true, render: true };
			},
			invalidate() {},
			dispose() {
				disposed = true;
				clearInterval(timer);
				deps.onRender?.(() => {});
			},
		};
	};
}
