/**
 * pi-warm-ui: a calm layout for the pi interactive mode.
 *
 * - The editor's bottom border shows the model and the thinking level.
 *   In bash mode it shows "bash" instead. The top border keeps pi's working status.
 * - The footer is one line: the working directory and git branch on the left,
 *   token usage, cache hit rate, cost and a context meter on the right.
 *   When the terminal is narrow, the footer drops the least important parts first.
 * - Extension statuses (goal, plan mode, ...) go on a second line only when they exist.
 *
 * Configuration (optional): <agent dir>/warm-ui.json
 *   {
 *     "enabled": true,                     // false keeps pi's own footer and editor
 *     "contextMeter": true,                // false shows only the percentage
 *     "hideStatuses": ["pi-code-status"]   // status keys that the footer does not show
 *   }
 * The command "/warm-ui on|off" switches the layout for the current session.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface Config {
	enabled: boolean;
	contextMeter: boolean;
	hideStatuses: string[];
}

// pi-code mirrors the Claude Code statusLine into this status.
// It repeats the model and the context usage that this footer already shows.
const DEFAULT_CONFIG: Config = { enabled: true, contextMeter: true, hideStatuses: ["pi-code-status"] };
const METER_CELLS = 10;

function loadConfig(): Config {
	const file = path.join(getAgentDir(), "warm-ui.json");
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		return {
			enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
			contextMeter: typeof raw.contextMeter === "boolean" ? raw.contextMeter : DEFAULT_CONFIG.contextMeter,
			hideStatuses: Array.isArray(raw.hideStatuses) ? raw.hideStatuses.map(String) : DEFAULT_CONFIG.hideStatuses,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	hitRate?: number;
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

function formatCwd(cwd: string): string {
	const home = os.homedir();
	if (cwd === home) return "~";
	return cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Replace middle segments with "…" until the path fits in max columns. */
function shortenPath(cwd: string, max: number): string {
	const segs = cwd.split(path.sep);
	while (visibleWidth(segs.join(path.sep)) > max && segs.length > 3) {
		segs.splice(1, segs[1] === "…" ? 2 : 1, "…");
	}
	return segs.join(path.sep);
}

/** Put left and right on one line. If they do not fit, truncate left first, then right. */
function spread(left: string, right: string, width: number): string {
	const gap = 2;
	const rw = visibleWidth(right);
	if (rw + gap >= width) return truncateToWidth(right, width, "…");
	const l = truncateToWidth(left, width - rw - gap, "…");
	return l + " ".repeat(Math.max(0, width - visibleWidth(l) - rw)) + right;
}

// Same scope as pi's built-in footer: all entries, including other branches and compacted history.
function sumUsage(ctx: ExtensionContext): Totals {
	const t: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	const add = (u: any) => {
		if (!u) return;
		t.input += u.input ?? 0;
		t.output += u.output ?? 0;
		t.cacheRead += u.cacheRead ?? 0;
		t.cacheWrite += u.cacheWrite ?? 0;
		t.cost += u.cost?.total ?? 0;
	};
	for (const e of ctx.sessionManager.getEntries() as any[]) {
		if (e.type === "usage") add(e.usage);
		else if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) add(e.usage);
		else if (e.type === "message" && e.message?.role === "toolResult") add(e.message.usage);
		else if (e.type === "message" && e.message?.role === "assistant") {
			const u = e.message.usage;
			add(u);
			const prompt = (u?.input ?? 0) + (u?.cacheRead ?? 0) + (u?.cacheWrite ?? 0);
			t.hitRate = prompt > 0 ? ((u?.cacheRead ?? 0) / prompt) * 100 : undefined;
		}
	}
	return t;
}

/** Context usage: an optional meter plus "12% of 200k". The color changes above 70% and 90%. */
function renderContext(theme: Theme, ctx: ExtensionContext, withMeter: boolean, short: boolean): string | undefined {
	const usage = ctx.getContextUsage();
	const window = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!window) return undefined;
	const pct = usage?.percent ?? null;
	const color = pct !== null && pct > 90 ? "error" : pct !== null && pct > 70 ? "warning" : "dim";
	const pctText = pct === null ? "?" : pct < 10 ? pct.toFixed(1) : `${Math.round(pct)}`;
	const label = theme.fg(color, short ? `${pctText}%` : `${pctText}% of ${formatTokens(window)}`);
	if (!withMeter || pct === null) return short ? label : theme.fg("dim", "ctx ") + label;
	const filled = pct <= 0 ? 0 : Math.min(METER_CELLS, Math.max(1, Math.round((pct / 100) * METER_CELLS)));
	const meter =
		theme.fg(color === "dim" ? "muted" : color, "━".repeat(filled)) +
		theme.fg("borderMuted", "━".repeat(METER_CELLS - filled));
	return `${meter} ${label}`;
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	let enabled = config.enabled;

	const apply = (ctx: ExtensionContext) => {
		if (!enabled) {
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
			return;
		}

		// The footer renders on every frame. Recount usage only when the entry count changes.
		let cache: { count: number; totals: Totals } | undefined;
		const totals = () => {
			const count = ctx.sessionManager.getEntries().length;
			if (cache?.count !== count) cache = { count, totals: sumUsage(ctx) };
			return cache.totals;
		};

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(fullWidth: number): string[] {
					// One column of margin on each side aligns the footer with the transcript.
					const margin = fullWidth > 40 ? 1 : 0;
					const width = fullWidth - margin * 2;
					const dot = theme.fg("dim", " · ");
					const t = totals();
					const cwd = formatCwd(ctx.sessionManager.getCwd());
					const branch = footerData.getGitBranch();
					const name = ctx.sessionManager.getSessionName();

					// Parts to drop when the line is too narrow, least important first.
					const show = { cache: true, tokens: true, name: true, meter: config.contextMeter, longContext: true, cost: true };
					// The terminal title already shows the session name, so it goes early.
					const drops: (keyof typeof show)[] = ["cache", "name", "tokens", "meter", "longContext", "cost"];

					let right = "";
					let suffix = "";
					for (;;) {
						const parts: string[] = [];
						if (show.tokens && (t.input || t.output)) {
							parts.push(theme.fg("dim", `↑${formatTokens(t.input)} ↓${formatTokens(t.output)}`));
						}
						if (show.cache && (t.cacheRead || t.cacheWrite) && t.hitRate !== undefined) {
							parts.push(theme.fg("dim", `cache ${Math.round(t.hitRate)}%`));
						}
						if (show.cost && t.cost) parts.push(theme.fg("dim", `$${t.cost.toFixed(t.cost >= 1 ? 2 : 3)}`));
						const context = renderContext(theme, ctx, show.meter, !show.longContext);
						if (context) parts.push(context);
						right = parts.join(dot);
						suffix = (branch ? `  ⎇ ${branch}` : "") + (show.name && name ? `  · ${name}` : "");
						const leftMin = Math.min(visibleWidth(cwd), 16) + visibleWidth(suffix);
						const next = drops.find((key) => show[key]);
						if (visibleWidth(right) + 2 + leftMin <= width || next === undefined) break;
						show[next] = false;
					}

					// Left: parent path in dim, current directory in muted, branch in dim.
					const room = width - visibleWidth(right) - 2 - visibleWidth(suffix);
					const shown = shortenPath(cwd, Math.max(room, 16));
					const cut = shown.lastIndexOf(path.sep);
					const left =
						theme.fg("dim", shown.slice(0, cut + 1)) + theme.fg("muted", shown.slice(cut + 1)) + theme.fg("dim", suffix);

					const lines = [spread(left, right, width)];
					const statuses = [...footerData.getExtensionStatuses().entries()]
						.filter(([key]) => !config.hideStatuses.includes(key))
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text.replace(/\s+/g, " ").trim())
						.filter(Boolean);
					if (statuses.length) lines.push(truncateToWidth(statuses.join("   "), width, "…"));
					const pad = " ".repeat(margin);
					return lines.map((line) => pad + line);
				},
			};
		});

		class WarmEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { embedWorkingStatus: true });
			}

			// Bottom border: "──────── model · level ───". It keeps pi's "↓ N more" border while the text scrolls.
			protected renderBottomBorder(width: number, linesBelow: number): string {
				const model = ctx.model?.id;
				if (linesBelow > 0 || !model) return super.renderBottomBorder(width, linesBelow);
				const theme = ctx.ui.theme;
				const input = this.getText().trimStart();
				let label: string;
				if (input.startsWith("!")) {
					// pi colors the border with bashMode while the input is a shell command.
					label = this.borderColor(input.startsWith("!!") ? "bash · no context" : "bash");
				} else {
					label = theme.fg("muted", model);
					if (ctx.model?.reasoning) {
						const level = pi.getThinkingLevel();
						label += theme.fg("dim", " · ") + this.borderColor(level === "off" ? "thinking off" : level);
					}
				}
				label = ` ${label} `;
				const lw = visibleWidth(label);
				if (lw + 6 > width) return super.renderBottomBorder(width, linesBelow);
				return this.borderColor("─".repeat(width - lw - 3)) + label + this.borderColor("───");
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new WarmEditor(tui, theme, keybindings));
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") apply(ctx);
	});

	pi.registerCommand("warm-ui", {
		description: "Switch the warm-ui layout for this session: on or off",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg !== "on" && arg !== "off") {
				ctx.ui.notify(`warm-ui is ${enabled ? "on" : "off"}. Usage: /warm-ui on|off`, "info");
				return;
			}
			enabled = arg === "on";
			apply(ctx);
		},
	});
}
