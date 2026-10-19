/**
 * The status bar: one line rendered in one of five styles.
 *
 *   band  — two rounded capsule bands on a colored background (default, like oh-my-pi)
 *   plain — the same items as colored text, no background
 *   bar   — a single full-width solid background row, no caps; falls back to plain when pal.bg is
 *            absent or total < 24
 *   rail  — no background; left and right groups joined by a dim rule (─ / -); falls back to plain
 *            when fewer than 3 columns remain for the rule
 *   panel — a rounded box that fills the width, in three rows (after claude-warm-statusline):
 *
 *             ╭─  glm-5.3 · max ─  acme-api ─  feat/rate-limit +1 ~1 ?1 ───────  rate limit fix ─╮
 *             │  ctx ━━━━━━──── 62% of 1M            617k 720  99%  0.010                       │
 *             ╰─  2 ───────────────────────────────────────────────────────────────────────────────╯
 *
 *            The top border starts with the model and the thinking level, then the directory, the
 *            branch with counts and the session name. The middle row carries the context usage on
 *            the left and the usage totals on the right. The bottom border carries the running
 *            subagents. A side without content leaves a plain border. The border takes the context
 *            level color. Below PANEL_MIN_WIDTH, or when no rung fits, the panel falls back to
 *            plain text.
 *
 * Left group: the project name (bold) and the git branch with counts.
 * Right group: running subagents, session name, usage and context window.
 * Blank columns separate items inside a group; a larger gap separates groups.
 *
 * Colors: project, git and subagent colors come from the theme's status line palette (palette.ts).
 * Secondary text uses the theme's "muted" color. Context usage keeps its level color.
 *
 * Width: the line steps down LADDER until it fits. Blank columns shrink first, then the long context
 * text, then the least important items, then the branch, and last the project name. The shortest
 * context text is never dropped. Below BAND_MIN_WIDTH the band/bar/rail decoration goes. Below
 * CONTEXT_ONLY_WIDTH only the context usage stays.
 */
import os from "node:os";
import path from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Color, mixColors, rgbColor, sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { formatTokens } from "./format.ts";
import { type GitStatus, type GitTracker, isDirty } from "./git.ts";
import { type Icons, icons, withIcon } from "./icons.ts";
import { type Palette, paletteFor } from "./palette.ts";

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

/**
 * Panel color levels: green up to 30%, yellow up to 50%, orange up to 70%, clay up to 85%, red up to
 * 95%, dark red above. The yellow step mixes the theme's green and orange, because some themes use a
 * green or a purple number color, and the six steps must stay distinct. The clay and dark red shades
 * are fixed, so all five themes end the ramp the same way.
 */
function panelLevelColor(theme: Theme, pct: number): Color {
	if (pct > 95) return rgbColor(0xd0, 0x30, 0x30);
	if (pct > 85) return theme.colors.error;
	if (pct > 70) return rgbColor(0xe0, 0x5a, 0x46);
	if (pct > 50) return theme.colors.warning;
	if (pct > 30) return mixColors(theme.colors.success, theme.colors.warning, 0.5);
	return theme.colors.success;
}

/** Below this width the footer is plain text: the project name and the context usage. No band, caps or icons. */
const BAND_MIN_WIDTH = 24;
/** Below this width the footer shows the context usage only. */
const CONTEXT_ONLY_WIDTH = 8;
/** Columns that a shortened project name or branch keeps at least. */
const PROJECT_MIN = 6;
const BRANCH_MIN = 8;
/** Columns that the session name takes at most. */
const SESSION_MAX = 24;
/**
 * Below this width the panel falls back to plain text. The model segment sets the floor: the box must
 * keep the model name, the directory, the context percentage and the borders on one row.
 */
const PANEL_MIN_WIDTH = 24;
/** Columns that the border fill keeps on the top and bottom rows. */
const PANEL_EDGE_FILL = 3;
/** Columns that the middle row keeps between its two sides. */
const PANEL_MID_FILL = 2;
/** Cells of the context bar in the panel. */
const PANEL_BAR_FULL = 10;
const PANEL_BAR_SHORT = 5;
const ELLIPSIS = "…";

/**
 * One step of the width ladder. margin: blank columns outside each band. pad: blank columns inside a band,
 * next to its ends. item: gap between items of one group. group: gap between groups. gap: smallest gap
 * between the two bands. The flags show or hide parts.
 */
interface Rung {
	margin: number;
	pad: number;
	item: number;
	group: number;
	gap: number;
	longContext: boolean;
	cache: boolean;
	session: boolean;
	gitDetail: boolean;
	tokens: boolean;
	cost: boolean;
	agents: boolean;
	/** Icons before the project, the branch and the context usage. */
	icons: boolean;
	branch: boolean;
	/** The rung may shorten the branch (project name) to fit. */
	clipBranch: boolean;
	clipProject: boolean;
}

// Widest first. Each rung only removes or shrinks, so a narrower line never shows more than a wider one.
const LADDER: Rung[] = (() => {
	let rung: Rung = {
		margin: 2,
		pad: 2,
		item: 2,
		group: 4,
		gap: 4,
		longContext: true,
		cache: true,
		session: true,
		gitDetail: true,
		tokens: true,
		cost: true,
		agents: true,
		icons: true,
		branch: true,
		clipBranch: false,
		clipProject: false,
	};
	const rungs = [rung];
	const step = (change: Partial<Rung>) => rungs.push((rung = { ...rung, ...change }));
	step({ margin: 1, pad: 1, group: 3, gap: 3 });
	step({ item: 1, group: 2, gap: 2 });
	step({ gap: 1 });
	step({ longContext: false });
	step({ cache: false });
	step({ session: false });
	step({ gitDetail: false });
	step({ tokens: false });
	step({ cost: false });
	step({ agents: false, clipBranch: true });
	step({ icons: false });
	step({ branch: false, clipProject: true });
	return rungs;
})();

/** A piece of text with one style. Layout measures the plain text, so a cut never lands inside an escape code. */
interface Part {
	plain: string;
	paint?: (text: string) => string;
}

/** The parts of one item. They stay together. */
type Item = Part[];

const spaces = (n: number) => " ".repeat(Math.max(0, n));
const gapPart = (n: number): Part => ({ plain: spaces(n) });

/** Control characters and blanks become one space, so a name cannot break the line. */
const tidy = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();

/**
 * Shorten plain text to `max` columns and end it with an ellipsis. This cuts text and not escape codes:
 * truncateToWidth() resets all styles at the cut, which would end the band background early.
 */
function clip(text: string, max: number): string {
	if (max <= 0) return "";
	if (visibleWidth(text) <= max) return text;
	return sliceByColumn(text, 0, max - visibleWidth(ELLIPSIS), true).trimEnd() + ELLIPSIS;
}

/** Groups of items to one flat list: `item` blank columns inside a group, `group` between groups. */
function flatten(groups: Item[][], item: number, group: number): Part[] {
	const parts: Part[] = [];
	for (const items of groups) {
		const filled = items.filter((one) => one.length > 0);
		if (filled.length === 0) continue;
		if (parts.length) parts.push(gapPart(group));
		filled.forEach((one, n) => {
			if (n) parts.push(gapPart(item));
			parts.push(...one);
		});
	}
	return parts;
}

/** Columns of a part list. */
const partWidth = (parts: Part[]) => parts.reduce((sum, part) => sum + visibleWidth(part.plain), 0);
/** The parts with their styles. */
const paintParts = (parts: Part[]) => parts.map((part) => (part.paint ? part.paint(part.plain) : part.plain)).join("");

/** The two sides of one panel row. Either side may be empty. */
interface PanelSide {
	left: Part[];
	right: Part[];
}

/**
 * Draw one row and report how many columns it needs beyond `width`.
 *
 * Top and bottom rows carry `─` between the two sides; the middle row carries blank columns. Each side
 * keeps one blank column next to its fill, and the middle row keeps `midFill` columns between a left
 * and a right side. A side without content leaves its fill to run to the border.
 */
function panelRow(
	width: number,
	row: "top" | "middle" | "bottom",
	side: PanelSide,
	paint: (text: string) => string,
	sep: (text: string) => string,
): { line: string; over: number } {
	const lw = partWidth(side.left);
	const rw = partWidth(side.right);
	if (row === "middle") {
		const both = lw > 0 && rw > 0;
		const n = width - 2 - (lw ? lw + 2 : 0) - (rw ? rw + 1 : 0) - (both ? 3 : 0);
		const need = both ? PANEL_MID_FILL : 0;
		const line =
			paint("│") +
			(lw ? `  ${paintParts(side.left)}` : "") +
			(both ? sep(" │ ") : "") +
			spaces(Math.max(n, 0)) +
			(rw ? `${paintParts(side.right)} ` : "") +
			paint("│");
		return { line, over: Math.max(0, need - n) };
	}
	const n = width - 2 - 2 - (lw ? lw + 2 : 0) - (rw ? rw + 2 : 0);
	const lead = row === "top" ? "╭─" : "╰─";
	const corner = row === "top" ? "─╮" : "─╯";
	const line =
		paint(lead) +
		(lw ? ` ${paintParts(side.left)} ` : "") +
		(n > 0 ? paint("─".repeat(n)) : "") +
		(rw ? ` ${paintParts(side.right)} ` : "") +
		paint(corner);
	return { line, over: Math.max(0, PANEL_EDGE_FILL - n) };
}

/** Everything that the panel draws. Built once per render from the footer state. */
interface PanelData {
	ic: Icons;
	pal: Palette;
	theme: Theme;
	/** Paint with a concrete color. */
	paint: (color: Color) => (text: string) => string;
	/** Paint with a theme token such as "muted". */
	token: (name: Token) => (text: string) => string;
	project: string;
	branch: string;
	status: GitStatus | undefined;
	name: string;
	agents: number;
	totals: Totals;
	window: number | undefined;
	pct: number | null;
	pctText: string;
	/** The current model id, or "" when pi reports no model. */
	model: string;
	/** The current thinking level, or undefined when the model does not think or the level is "off". */
	effort: string | undefined;
	/** Paint with the thinking level color, the same ramp the editor border uses. */
	effortPaint: (text: string) => string;
}

/** Parts that the panel can leave out. The ladder below turns them off one at a time. */
interface PanelShow {
	icons: boolean;
	gitDetail: boolean;
	session: boolean;
	branch: boolean;
	agents: boolean;
	tokens: boolean;
	cache: boolean;
	cost: boolean;
	longContext: boolean;
	bar: "full" | "short" | "off";
	label: boolean;
	/** The model name. It goes last, so the top border always says which model runs. */
	model: boolean;
	/** The thinking level. It goes after the model name is clipped, and before the model name goes. */
	effort: boolean;
}

/** The columns that a shortened project name keeps. */
const PANEL_PROJECT_MIN = 6;
/** Columns that the model name keeps while the thinking level still shows. */
const PANEL_MODEL_MIN = 8;
/** Columns that the model name keeps once the thinking level is gone. Below this the panel gives up: a
 *  name clipped to one column is not readable, and the plain fallback still shows the project and ctx. */
const PANEL_MODEL_FLOOR = 4;

/** Every part shown, at the widest width. The step lists below only switch parts off. */
const PANEL_SHOW: PanelShow = {
	icons: true,
	gitDetail: true,
	session: true,
	branch: true,
	agents: true,
	tokens: true,
	cache: true,
	cost: true,
	longContext: true,
	bar: "full",
	label: true,
	model: true,
	effort: true,
};

// One step list per row, least important first. The reference drops the title and the session name
// first and the directory last, so the session name goes early and the directory icon goes last.
// A long name is shortened before its segment goes; the project name keeps PANEL_PROJECT_MIN columns.
// Steps 1–5 of the top row, in order. The model name and the thinking level are not here: they are
// shortened and then dropped after these, in renderPanel(). The model name is never dropped outright.
const PANEL_TOP_STEPS: Partial<PanelShow>[] = [
	{ session: false },
	{ gitDetail: false },
	{ branch: false },
	{ icons: false },
];
const PANEL_MID_STEPS: Partial<PanelShow>[] = [
	{ cache: false },
	{ cost: false },
	{ tokens: false },
	{ longContext: false },
	{ bar: "short" },
	{ bar: "off" },
	{ label: false },
];
// The running-agent count is the only bottom-row item, so it goes last.
const PANEL_BOTTOM_STEPS: Partial<PanelShow>[] = [{ agents: false }, { icons: false }];

/** One run of `━`: the filled cells in the level color, the rest in the separator color. */
function panelBar(d: PanelData, cells: number, color: Color): Part[] {
	const filled = d.pct === null ? 0 : Math.round((Math.min(100, Math.max(0, d.pct)) / 100) * cells);
	const parts: Part[] = [];
	if (filled > 0) parts.push({ plain: "━".repeat(filled), paint: d.paint(color) });
	if (cells - filled > 0) parts.push({ plain: "━".repeat(cells - filled), paint: d.paint(d.pal.sep) });
	return parts;
}

/** The top row: the directory and the project name, then the branch, then the counts (left side), and the session name (right side). */
function builtTop(d: PanelData, show: PanelShow, projectMax = Infinity, modelMax = Infinity): PanelSide {
	const lead = (icon: string) => (show.icons ? icon : "");
	const left: Part[] = [];
	// The model and the thinking level come first, right after the "╭─". edit.ts draws the same pair on
	// the input's bottom border; the repeat keeps the model visible while the transcript scrolls.
	const first: Part[] = [];
	if (show.model && d.model) {
		const label = clip(d.model, modelMax);
		first.push({ plain: lead(d.ic.model) ? `${lead(d.ic.model)} ` : "", paint: d.paint(d.pal.model) });
		first.push({ plain: label, paint: d.paint(d.pal.model) });
	}
	// A thinking level shows only for a reasoning model that is not "off". No level means no "·".
	if (show.effort && d.effort) {
		if (first.length) first.push({ plain: " · ", paint: d.paint(d.pal.sep) });
		first.push({ plain: d.effort, paint: d.effortPaint });
	}
	if (first.length) left.push(...first, { plain: " ─ ", paint: d.paint(d.pal.sep) });
	if (lead(d.ic.dir)) left.push({ plain: `${lead(d.ic.dir)} `, paint: d.paint(d.pal.path) });
	left.push({ plain: clip(d.project, projectMax), paint: d.paint(d.pal.path) });
	if (show.branch && d.branch) {
		const tone = isDirty(d.status) ? d.pal.gitDirty : d.pal.gitClean;
		const repo: Part[] = [{ plain: withIcon(lead(d.ic.branch), d.branch, " "), paint: d.paint(tone) }];
		if (show.gitDetail && d.status) {
			const marks: Part[] = [];
			if (d.status.ahead) marks.push({ plain: `${d.ic.ahead}${d.status.ahead}`, paint: d.token("muted") });
			if (d.status.behind) marks.push({ plain: `${d.ic.behind}${d.status.behind}`, paint: d.token("muted") });
			if (d.status.staged) marks.push({ plain: `+${d.status.staged}`, paint: d.paint(d.pal.staged) });
			if (d.status.unstaged) marks.push({ plain: `~${d.status.unstaged}`, paint: d.paint(d.pal.dirty) });
			if (d.status.untracked) marks.push({ plain: `?${d.status.untracked}`, paint: d.paint(d.pal.untracked) });
			if (marks.length) repo.push(gapPart(1), ...marks.flatMap((mark, n) => (n ? [gapPart(1), mark] : [mark])));
		}
		left.push({ plain: " ─ ", paint: d.paint(d.pal.sep) }, ...repo);
	}
	// pi has no mode or permission chip, so the right side carries the session name only.
	const right: Part[] =
		show.session && d.name ? [{ plain: withIcon(lead(d.ic.session), clip(d.name, SESSION_MAX), " "), paint: d.token("muted") }] : [];
	return { left, right };
}

/** The middle row: the context usage (left side) and the usage totals (right side). pi has no 5h or 7d quota. */
function buildMid(d: PanelData, show: PanelShow): PanelSide {
	const lead = (icon: string) => (show.icons ? icon : "");
	const left: Part[] = [];
	if (d.window !== undefined) {
		const pctColor = d.pct === null ? d.pal.sep : panelLevelColor(d.theme, d.pct);
		// The reference keeps the "ctx" label in every icon set, so the box reads the same everywhere.
		if (show.label) left.push({ plain: "ctx", paint: d.paint(pctColor) });
		const cells = show.bar === "full" ? PANEL_BAR_FULL : show.bar === "short" ? PANEL_BAR_SHORT : 0;
		if (cells > 0) left.push(...(left.length ? [gapPart(1)] : []), ...panelBar(d, cells, pctColor));
		if (left.length) left.push(gapPart(1));
		left.push({ plain: d.pctText, paint: d.paint(pctColor) });
		if (show.longContext) left.push(gapPart(1), { plain: `of ${formatTokens(d.window)}`, paint: d.token("muted") });
	}

	const right: Part[] = [];
	const items: Part[][] = [];
	if (show.tokens && (d.totals.input || d.totals.output)) {
		items.push([
			{ plain: withIcon(lead(d.ic.up), formatTokens(d.totals.input), d.ic.gap), paint: d.paint(d.pal.spend) },
			gapPart(1),
			{ plain: withIcon(lead(d.ic.down), formatTokens(d.totals.output), d.ic.gap), paint: d.paint(d.pal.output) },
		]);
	}
	if (show.cache && (d.totals.cacheRead || d.totals.cacheWrite) && d.totals.hitRate !== undefined) {
		items.push([{ plain: withIcon(lead(d.ic.cache), `${Math.round(d.totals.hitRate)}%`, d.ic.gap), paint: d.paint(d.pal.gitClean) }]);
	}
	if (show.cost && d.totals.cost) {
		items.push([
			{ plain: withIcon(lead(d.ic.cost), d.totals.cost.toFixed(d.totals.cost >= 1 ? 2 : 3), d.ic.gap), paint: d.paint(d.pal.cost) },
		]);
	}
	items.forEach((item, n) => {
		if (n) right.push(gapPart(2));
		right.push(...item);
	});
	return { left, right };
}

/** The bottom row: the running subagents (left side). pi has no speed data, so the right side stays empty. */
function buildBottom(d: PanelData, show: PanelShow): PanelSide {
	const left: Part[] =
		show.agents && d.agents
			? [{ plain: withIcon(show.icons ? d.ic.subagents : "", `${d.agents}`, " "), paint: d.paint(d.pal.subagents) }]
			: [];
	return { left, right: [] };
}

/**
 * The panel, or undefined when the width is too small. Each row steps down its own rungs and shortens
 * the project name on its own, so a long branch cannot starve the middle row.
 */
function renderPanel(d: PanelData, total: number): { lines: string[] } | undefined {
	if (total < PANEL_MIN_WIDTH) return undefined;
	const border = d.paint(d.pct === null ? d.pal.sep : panelLevelColor(d.theme, d.pct));
	const sep = d.paint(d.pal.sep);
	/** Start from the widest arrangement and drop one part per step until the row fits. */
	const fitRow = (row: "middle" | "bottom", show: PanelShow, steps: Partial<PanelShow>[]): string => {
		const build = () => {
			const side = row === "middle" ? buildMid(d, show) : buildBottom(d, show);
			return panelRow(total, row, side, border, sep);
		};
		let drawn = build();
		for (let i = 0; i < steps.length && drawn.over > 0; i++) {
			Object.assign(show, steps[i]);
			drawn = build();
		}
		return drawn.line;
	};

	// The top row gives things up in this order, and stops as soon as the row fits:
	//   1. the session name            5. the directory icon
	//   2. the git counts              6. shorten the directory to PANEL_PROJECT_MIN columns
	//   3. the branch                  7. shorten the model name, keeping the thinking level
	//   4. the branch icon             8. the thinking level
	// The model name is never dropped outright: it is shortened, so the border always says which model
	// runs. The level outlives the name only as far as step 7 lets it; it is the last thing to go.
	const show = { ...PANEL_SHOW };
	let prjMax = Infinity;
	let modelMax = Infinity;
	const topOver = () => panelRow(total, "top", builtTop(d, show, prjMax, modelMax), border, sep).over;
	const topLine = () => panelRow(total, "top", builtTop(d, show, prjMax, modelMax), border, sep).line;
	let top = topLine();

	for (const step of PANEL_TOP_STEPS) {
		if (topOver() <= 0) break;
		Object.assign(show, step);
		top = topLine();
	}
	// 6: shorten the directory, never below PANEL_PROJECT_MIN columns.
	if (topOver() > 0 && visibleWidth(d.project) > PANEL_PROJECT_MIN) {
		const room = visibleWidth(d.project) - topOver();
		if (room >= PANEL_PROJECT_MIN) {
			prjMax = room;
			top = topLine();
		}
	}
	// 7: shorten the model name. While the level still shows it keeps PANEL_MODEL_MIN columns, so the pair
	// stays readable; once the level is gone it keeps PANEL_MODEL_FLOOR, which is the last readable width.
	const clipModel = () => {
		const over = topOver();
		if (over <= 0) return;
		const floor = show.effort ? PANEL_MODEL_MIN : PANEL_MODEL_FLOOR;
		const room = visibleWidth(d.model) - over;
		if (room >= Math.min(floor, visibleWidth(d.model)) && room < modelMax) {
			modelMax = room;
			top = topLine();
		}
	};
	clipModel();
	// 8: the thinking level is the last to go. The model name stays.
	if (topOver() > 0 && show.effort) {
		show.effort = false;
		top = topLine();
		clipModel();
	}
	// A model name that still does not fit means the panel cannot draw. Plain text takes over.
	if (topOver() > 0) return undefined;
	return {
		lines: [
			top,
			fitRow("middle", { ...PANEL_SHOW }, PANEL_MID_STEPS),
			fitRow("bottom", { ...PANEL_SHOW }, PANEL_BOTTOM_STEPS),
		],
	};
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
				const total = Math.floor(fullWidth);
				if (!(total > 0)) return [""];

				const ic = icons(config.icons);
				const pal = paletteFor(theme);
				const style = config.statusBar;
				// "bar" and "band" need pal.bg. Fall back to plain when it is absent.
				const hasBg = pal.bg !== undefined;
				// Effective style: resolve fallbacks here so the rest of the code is simple.
				const effectiveStyle: "band" | "plain" | "bar" | "rail" | "panel" =
					style === "panel"
						? "panel"
						: (style === "bar" && (!hasBg || total < BAND_MIN_WIDTH))
							? "plain"
							: (style === "band" && !hasBg)
								? "plain"
								: style;
				const band = effectiveStyle === "band";
				const color = (c: Color) => (text: string) => theme.style(text, { fg: c });
				const token = (name: Token) => (text: string) => theme.fg(name, text);
				const muted = token("muted");
				const bold = (text: string) => theme.style(text, { fg: pal.path, bold: true });

				const t = totals();
				const project = tidy(projectName(ctx.sessionManager.getCwd()));
				const branch = tidy(footerData.getGitBranch() ?? "");
				const status = branch ? git.status : undefined;
				const name = tidy(ctx.sessionManager.getSessionName() ?? "");
				const agents = deps.agents();

				// Without a context window there is no context text. The footer does not invent one.
				const usage = ctx.getContextUsage();
				const window = usage?.contextWindow ?? ctx.model?.contextWindow;
				const pct = usage?.percent ?? null;
				const level: Token = pct === null ? "muted" : levelToken(pct);
				const pctText = `${pct === null ? "?" : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;

				// Model and thinking level come from live getters on ctx, the same source editor.ts reads.
				// pi marks the old ctx stale after /reload and a session switch, so both reads are guarded.
				let modelId = "";
				let effort: string | undefined;
				let effortLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" = "off";
				try {
					const current = ctx.model;
					modelId = tidy(current?.id ?? current?.name ?? "");
					// A level shows only when the model thinks and the level is not "off".
					const raw = ctx.thinkingLevel;
					if (current?.reasoning && raw && raw !== "off") {
						effort = raw;
						effortLevel = raw;
					}
				} catch {
					// A stale ctx reads as no model, and the border carries the rest.
				}
				// theme.getThinkingBorderColor is the ramp that editor.ts reaches through borderColor.
				const effortPaint = (text: string) => theme.getThinkingBorderColor(effortLevel)(text);

				const measure = (parts: Part[]) => parts.reduce((sum, part) => sum + visibleWidth(part.plain), 0);
				const draw = (parts: Part[]) => parts.map((part) => (part.paint ? part.paint(part.plain) : part.plain)).join("");

				// The panel is its own layout. When it does not fit, the plain text below draws instead.
				const panel =
					effectiveStyle === "panel"
						? renderPanel(
								{
									ic,
									pal,
									theme,
									paint: color,
									token,
									project,
									branch,
									status,
									name,
									agents,
									totals: t,
									window,
									pct,
									pctText,
									model: modelId,
									effort,
									effortPaint,
								},
								total,
							)
						: undefined;

				/** A band around the parts, or the bare parts in plain/bar/rail style. Drawn only for the rung that fits. */
				const pill = (parts: Part[], rung: Rung) => {
					if (parts.length === 0) return { width: 0, draw: () => "" };
					if (!band) return { width: measure(parts), draw: () => draw(parts) };
					const inner = [gapPart(rung.pad), ...parts, gapPart(rung.pad)];
					const cap = (glyph: string) => (glyph ? theme.style(glyph, { fg: pal.bg! }) : "");
					return {
						width: visibleWidth(ic.capLeft) + measure(inner) + visibleWidth(ic.capRight),
						draw: () => cap(ic.capLeft) + theme.style(draw(inner), { bg: pal.bg! }) + cap(ic.capRight),
					};
				};

				const leftGroups = (rung: Rung, projectMax: number, branchMax: number): Item[][] => {
					const lead = (icon: string) => (rung.icons ? icon : "");
					const dir: Item = [];
					if (lead(ic.dir)) dir.push({ plain: `${ic.dir} `, paint: color(pal.path) });
					dir.push({ plain: clip(project, projectMax), paint: bold });

					const repo: Item = [];
					if (branch && rung.branch) {
						const tone = color(isDirty(status) ? pal.gitDirty : pal.gitClean);
						repo.push({ plain: withIcon(lead(ic.branch), clip(branch, branchMax), " "), paint: tone });
						if (rung.gitDetail && status) {
							const marks: Part[] = [];
							if (status.ahead) marks.push({ plain: `${ic.ahead}${status.ahead}`, paint: muted });
							if (status.behind) marks.push({ plain: `${ic.behind}${status.behind}`, paint: muted });
							if (status.staged) marks.push({ plain: `+${status.staged}`, paint: color(pal.staged) });
							if (status.unstaged) marks.push({ plain: `~${status.unstaged}`, paint: color(pal.dirty) });
							if (status.untracked) marks.push({ plain: `?${status.untracked}`, paint: color(pal.untracked) });
							marks.forEach((mark, n) => repo.push(gapPart(n === 0 ? rung.item : 1), mark));
						}
					}
					return [[dir], [repo]];
				};

				const rightGroups = (rung: Rung): Item[][] => {
					const live: Item =
						rung.agents && agents
							? [{ plain: withIcon(ic.subagents, `${agents}`, " "), paint: color(pal.subagents) }]
							: [];
					const session: Item =
						rung.session && name ? [{ plain: withIcon(ic.session, clip(name, SESSION_MAX), " "), paint: muted }] : [];
					const tokens: Item =
						rung.tokens && (t.input || t.output)
							? [
									{
										plain: `${withIcon(ic.up, formatTokens(t.input), ic.gap)} ${withIcon(ic.down, formatTokens(t.output), ic.gap)}`,
										paint: muted,
									},
								]
							: [];
					const cache: Item =
						rung.cache && (t.cacheRead || t.cacheWrite) && t.hitRate !== undefined
							? [{ plain: withIcon(ic.cache, `${Math.round(t.hitRate)}%`, ic.gap), paint: muted }]
							: [];
					const cost: Item =
						rung.cost && t.cost
							? [{ plain: withIcon(ic.cost, t.cost.toFixed(t.cost >= 1 ? 2 : 3), ic.gap), paint: muted }]
							: [];
					const context: Item = [];
					if (window) {
						const icon = rung.icons && ic.context ? `${ic.context} ` : "";
						context.push({ plain: icon + pctText, paint: token(level) });
						if (rung.longContext) context.push({ plain: ` of ${formatTokens(window)}`, paint: muted });
					}
					return [[live, session], [tokens, cache, cost], [context]];
				};

				// `over` is the number of columns that the rung needs beyond the width. Zero or less means it fits.
				const attempt = (rung: Rung, projectMax = Infinity, branchMax = Infinity) => {
					const left = pill(flatten(leftGroups(rung, projectMax, branchMax), rung.item, rung.group), rung);
					const right = pill(flatten(rightGroups(rung), rung.item, rung.group), rung);
					const used = left.width + (right.width ? rung.gap + right.width : 0);
					return { rung, left, right, over: used - (total - rung.margin * 2) };
				};

				let fit: ReturnType<typeof attempt> | undefined;
				if (total >= BAND_MIN_WIDTH) {
					for (const rung of LADDER) {
						let tried = attempt(rung);
						if (tried.over > 0 && rung.clipBranch && rung.branch && branch) {
							const room = visibleWidth(branch) - tried.over;
							if (room >= Math.min(BRANCH_MIN, visibleWidth(branch))) tried = attempt(rung, Infinity, room);
						}
						if (tried.over > 0 && rung.clipProject) {
							const room = visibleWidth(project) - tried.over;
							if (room >= Math.min(PROJECT_MIN, visibleWidth(project))) tried = attempt(rung, room);
						}
						if (tried.over <= 0) {
							fit = tried;
							break;
						}
					}
				}

				let margin = 0;
				let line: string;
				if (panel) {
					// The panel replaces the single line. It fills the width, so it needs no margin.
					const statuses = [...footerData.getExtensionStatuses().entries()]
						.filter(([key]) => !config.hideStatuses.includes(key))
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text.replace(/\s+/g, " ").trim())
						.filter(Boolean);
					const lines = [...panel.lines];
					if (statuses.length) lines.push(truncateToWidth(statuses.join("   "), total, "…"));
					return lines;
				}
				if (fit) {
					margin = fit.rung.margin;
					const room = total - margin * 2;
					const gap = fit.right.width ? spaces(room - fit.left.width - fit.right.width) : "";

					if (effectiveStyle === "bar") {
						// Full-width solid background. All gaps also carry pal.bg.
						const leftStr = fit.left.draw();
						const rightStr = fit.right.draw();
						const fill = spaces(room - fit.left.width - fit.right.width);
						const inner = spaces(margin) + leftStr + fill + rightStr + spaces(margin);
						line = theme.style(inner, { bg: pal.bg! });
					} else if (effectiveStyle === "rail") {
						// Left and right groups connected by a dim rule. Rule char depends on icon set.
						const ruleChar = config.icons === "none" ? "-" : "─";
						const leftStr = fit.left.draw();
						const rightStr = fit.right.draw();
						const ruleWidth = room - fit.left.width - fit.right.width;
						// Minimum 3 cols for " ─ "; otherwise fall through to plain layout.
						if (ruleWidth >= 3) {
							const rule = " " + theme.style(ruleChar.repeat(ruleWidth - 2), { fg: pal.sep }) + " ";
							line = spaces(margin) + leftStr + rule + rightStr;
						} else {
							// Not enough room for the rule: render as plain.
							line = spaces(margin) + fit.left.draw() + gap + fit.right.draw();
						}
					} else {
						line = spaces(margin) + fit.left.draw() + gap + fit.right.draw();
					}
				} else {
					// Plain text: the project name, then the context usage. The context usage goes first when the width is tiny.
					const context = window ? theme.fg(level, clip(pctText, total)) : "";
					const room = total - (window ? visibleWidth(pctText) + 2 : 0);
					if (window && (total < CONTEXT_ONLY_WIDTH || room < 2)) line = context;
					else line = bold(clip(project, room)) + (window ? spaces(2) + context : "");
				}
				// Safety net for a width that the layout did not foresee. The tests make sure that it never runs.
				if (visibleWidth(line) > total) line = truncateToWidth(line, total, "");

				const statuses = [...footerData.getExtensionStatuses().entries()]
					.filter(([key]) => !config.hideStatuses.includes(key))
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => text.replace(/\s+/g, " ").trim())
					.filter(Boolean);
				const lines: string[] = ["", line];
				if (statuses.length) lines.push(spaces(margin) + truncateToWidth(statuses.join("   "), total - margin * 2, "…"));
				return lines;
			},
		};
	};
}
