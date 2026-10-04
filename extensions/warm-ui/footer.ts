/**
 * The status bar. "band" style (after oh-my-pi) draws two pills on the theme's status line background:
 *
 *    ~/projects/acme-api   feat/rate-limit +2 ~1 ?3         617k  720   0.010  ━━━━━━── 62% of 1M
 *
 * "plain" style draws the same segments as colored text. Colors come from the theme's status line
 * palette (palette.ts). When the line is too narrow, the least important parts go first.
 */
import os from "node:os";
import path from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Color, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { formatTokens } from "./format.ts";
import { type GitTracker, isDirty } from "./git.ts";
import { icons, withIcon } from "./icons.ts";
import { paletteFor } from "./palette.ts";

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

type Token = Parameters<Theme["fg"]>[0];

/** The project directory name, "~" for the home directory. */
function projectName(cwd: string): string {
	if (cwd === os.homedir()) return "~";
	return path.basename(cwd) || cwd;
}

/** Usage level of the context window: green up to 50%, yellow up to 70%, orange up to 90%, then red. */
function levelToken(pct: number): Token {
	if (pct > 90) return "error";
	if (pct > 70) return "warning";
	if (pct > 50) return "syntaxNumber";
	return "success";
}

export interface FooterDeps {
	config: Config;
	git: GitTracker;
	/** Number of subagent runs in progress. */
	agents: () => number;
	/** Called with the TUI's render request, so background updates can redraw the footer. */
	onRender: (request: () => void) => void;
}

type FooterFactory = Parameters<ExtensionContext["ui"]["setFooter"]>[0];

export function createFooter(ctx: ExtensionContext, deps: FooterDeps): FooterFactory {
	const { config, git } = deps;
	// The footer renders on every frame. Recount usage only when the entry count changes.
	let cache: { count: number; totals: Totals } | undefined;
	const totals = () => {
		const count = ctx.sessionManager.getEntries().length;
		if (cache?.count !== count) cache = { count, totals: sumUsage(ctx) };
		return cache.totals;
	};

	return (tui, theme, footerData) => {
		deps.onRender(() => tui.requestRender());
		const unsub = footerData.onBranchChange(() => {
			git.refresh();
			tui.requestRender();
		});
		return {
			dispose: unsub,
			invalidate() {},
			render(fullWidth: number): string[] {
				const ic = icons(config.icons);
				const pal = paletteFor(theme);
				const band = config.statusBar === "band" && pal.bg !== undefined;
				const fg = (color: Color, text: string) => theme.style(text, { fg: color });
				const margin = fullWidth > 40 ? 1 : 0;
				const width = fullWidth - margin * 2;

				const t = totals();
				const project = projectName(ctx.sessionManager.getCwd());
				const branch = footerData.getGitBranch();
				const status = branch ? git.status : undefined;
				const name = ctx.sessionManager.getSessionName();
				const agents = deps.agents();

				const pill = (segments: string[]) => {
					const parts = segments.filter(Boolean);
					if (parts.length === 0) return "";
					if (!band) return parts.join(config.icons === "nerd" ? "   " : theme.fg("dim", " · "));
					const inner = ` ${parts.join(` ${fg(pal.sep, ic.sep)} `)} `;
					const cap = (glyph: string) => (glyph ? theme.style(glyph, { fg: pal.bg! }) : "");
					return cap(ic.capLeft) + theme.style(inner, { bg: pal.bg! }) + cap(ic.capRight);
				};

				const context = (short: boolean) => {
					const usage = ctx.getContextUsage();
					const window = usage?.contextWindow ?? ctx.model?.contextWindow;
					if (!window) return "";
					const pct = usage?.percent ?? null;
					const level: Token = pct === null ? "dim" : levelToken(pct);
					const pctText = theme.fg(level, `${pct === null ? "?" : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`);
					const label = short ? pctText : pctText + fg(pal.context, ` of ${formatTokens(window)}`);
					return (ic.context ? `${theme.fg(level, ic.context)} ` : "") + label;
				};

				// Parts to drop when the line is too narrow, least important first.
				const show = { cache: true, name: true, gitDetail: true, tokens: true, longContext: true, cost: true };
				const drops: (keyof typeof show)[] = ["cache", "name", "gitDetail", "tokens", "longContext", "cost"];

				const gitSegment = () => {
					if (!branch) return "";
					const color = isDirty(status) ? pal.gitDirty : pal.gitClean;
					let text = fg(color, withIcon(ic.branch, branch, " "));
					if (show.gitDetail && status) {
						const marks: string[] = [];
						if (status.ahead) marks.push(fg(pal.context, `${ic.ahead}${status.ahead}`));
						if (status.behind) marks.push(fg(pal.context, `${ic.behind}${status.behind}`));
						if (status.staged) marks.push(fg(pal.staged, `+${status.staged}`));
						if (status.unstaged) marks.push(fg(pal.dirty, `~${status.unstaged}`));
						if (status.untracked) marks.push(fg(pal.untracked, `?${status.untracked}`));
						if (marks.length) text += ` ${marks.join(" ")}`;
					}
					return text;
				};

				const rightSegments = () => [
					agents ? fg(pal.subagents, withIcon(ic.subagents, `${agents}`, " ")) : "",
					show.name && name ? theme.fg("muted", withIcon(ic.session, name, " ")) : "",
					show.tokens && (t.input || t.output)
						? `${fg(pal.spend, withIcon(ic.up, formatTokens(t.input), ic.gap))} ${fg(pal.output, withIcon(ic.down, formatTokens(t.output), ic.gap))}`
						: "",
					show.cache && (t.cacheRead || t.cacheWrite) && t.hitRate !== undefined
						? fg(pal.gitClean, withIcon(ic.cache, `${Math.round(t.hitRate)}%`, ic.gap))
						: "",
					show.cost && t.cost ? fg(pal.cost, withIcon(ic.cost, t.cost.toFixed(t.cost >= 1 ? 2 : 3), ic.gap)) : "",
					context(!show.longContext),
				];

				const dir = ic.dir ? `${fg(pal.path, ic.dir)} ` : "";
				let left = "";
				let right = "";
				for (;;) {
					left = pill([dir + theme.bold(fg(pal.path, project)), gitSegment()]);
					right = pill(rightSegments());
					const next = drops.find((key) => show[key]);
					if (visibleWidth(right) + 1 + visibleWidth(left) <= width || next === undefined) break;
					show[next] = false;
				}

				const lw = visibleWidth(left);
				const rw = visibleWidth(right);
				const line =
					lw + 1 + rw <= width ? left + " ".repeat(width - lw - rw) + right : truncateToWidth(left, width, "…");

				const lines = [line];
				const statuses = [...footerData.getExtensionStatuses().entries()]
					.filter(([key]) => !config.hideStatuses.includes(key))
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => text.replace(/\s+/g, " ").trim())
					.filter(Boolean);
				if (statuses.length) lines.push(truncateToWidth(statuses.join("   "), width, "…"));
				const pad = " ".repeat(margin);
				return lines.map((l) => pad + l);
			},
		};
	};
}
