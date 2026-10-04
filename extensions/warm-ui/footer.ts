import path from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { formatCwd, formatTokens, shortenPath, spread } from "./format.ts";
import { type Icons, icons, withIcon } from "./icons.ts";

const METER_CELLS = 10;

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	hitRate?: number;
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

type Color = Parameters<Theme["fg"]>[0];

/** Usage level of the context window: green up to 50%, yellow up to 70%, orange up to 90%, then red. */
function levelColor(pct: number): Color {
	if (pct > 90) return "error";
	if (pct > 70) return "warning";
	if (pct > 50) return "syntaxNumber";
	return "success";
}

/** Each meter cell keeps the color of its own zone, so a full meter reads as a gradient. */
function meter(pct: number, theme: Theme): string {
	const filled = pct <= 0 ? 0 : Math.min(METER_CELLS, Math.max(1, Math.round((pct / 100) * METER_CELLS)));
	let out = "";
	for (let i = 0; i < METER_CELLS; i++) {
		out += i < filled ? theme.fg(levelColor(((i + 1) / METER_CELLS) * 100 - 1), "━") : theme.fg("borderMuted", "━");
	}
	return out;
}

/** Context usage: an icon, an optional meter and "12% of 200k". */
function renderContext(theme: Theme, ctx: ExtensionContext, ic: Icons, withMeter: boolean, short: boolean): string | undefined {
	const usage = ctx.getContextUsage();
	const window = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!window) return undefined;
	const pct = usage?.percent ?? null;
	const color: Color = pct === null ? "dim" : levelColor(pct);
	const pctText = theme.fg(color, `${pct === null ? "?" : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`);
	const label = short ? pctText : pctText + theme.fg("dim", ` of ${formatTokens(window)}`);
	const icon = ic.context ? theme.fg(color === "dim" ? "muted" : color, ic.context) + " " : "";
	if (!withMeter || pct === null) return icon + label;
	return `${icon}${meter(pct, theme)} ${label}`;
}

type FooterFactory = Parameters<ExtensionContext["ui"]["setFooter"]>[0];

/**
 * One line: the working directory and git branch on the left, usage on the right.
 * Extension statuses go on a second line only when they exist.
 */
export function createFooter(ctx: ExtensionContext, config: Config): FooterFactory {
	// The footer renders on every frame. Recount usage only when the entry count changes.
	let cache: { count: number; totals: Totals } | undefined;
	const totals = () => {
		const count = ctx.sessionManager.getEntries().length;
		if (cache?.count !== count) cache = { count, totals: sumUsage(ctx) };
		return cache.totals;
	};

	return (tui, theme, footerData) => {
		const unsub = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsub,
			invalidate() {},
			render(fullWidth: number): string[] {
				// One column of margin on each side aligns the footer with the transcript.
				const margin = fullWidth > 40 ? 1 : 0;
				const width = fullWidth - margin * 2;
				const ic = icons(config.icons);
				const sep = config.icons === "nerd" ? "  " : theme.fg("dim", " · ");
				const t = totals();
				const cwd = formatCwd(ctx.sessionManager.getCwd());
				const branch = footerData.getGitBranch();
				const name = ctx.sessionManager.getSessionName();

				// Parts to drop when the line is too narrow, least important first.
				// The terminal title already shows the session name, so it goes early.
				const show = { cache: true, name: true, tokens: true, meter: config.contextMeter, longContext: true, cost: true };
				const drops: (keyof typeof show)[] = ["cache", "name", "tokens", "meter", "longContext", "cost"];

				let right = "";
				let suffix = "";
				for (;;) {
					const parts: string[] = [];
					if (show.tokens && (t.input || t.output)) {
						const up = withIcon(ic.up, formatTokens(t.input), ic.gap);
						const down = withIcon(ic.down, formatTokens(t.output), ic.gap);
						parts.push(theme.fg("syntaxType", `${up} ${down}`));
					}
					if (show.cache && (t.cacheRead || t.cacheWrite) && t.hitRate !== undefined) {
						parts.push(theme.fg("success", withIcon(ic.cache, `${Math.round(t.hitRate)}%`, ic.gap)));
					}
					if (show.cost && t.cost) {
						parts.push(theme.fg("syntaxNumber", withIcon(ic.cost, t.cost.toFixed(t.cost >= 1 ? 2 : 3), ic.gap)));
					}
					const context = renderContext(theme, ctx, ic, show.meter, !show.longContext);
					if (context) parts.push(context);
					right = parts.join(sep);
					suffix = "";
					if (branch) suffix += `  ${theme.fg("syntaxKeyword", withIcon(ic.branch, branch, " "))}`;
					if (show.name && name) suffix += `  ${theme.fg("muted", withIcon(ic.session, name, " "))}`;
					const leftMin = Math.min(visibleWidth(cwd), 16) + 2 + visibleWidth(suffix);
					const next = drops.find((key) => show[key]);
					if (visibleWidth(right) + 2 + leftMin <= width || next === undefined) break;
					show[next] = false;
				}

				// Left: the folder icon and current directory in blue, parent path in dim, then branch and session.
				const dirIcon = ic.dir ? `${theme.fg("syntaxFunction", ic.dir)} ` : "";
				const room = width - visibleWidth(right) - 2 - visibleWidth(suffix) - visibleWidth(dirIcon);
				const shown = shortenPath(cwd, Math.max(room, 16));
				const cut = shown.lastIndexOf(path.sep);
				const left =
					dirIcon +
					theme.fg("dim", shown.slice(0, cut + 1)) +
					theme.bold(theme.fg("syntaxFunction", shown.slice(cut + 1))) +
					suffix;

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
	};
}
