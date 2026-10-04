#!/usr/bin/env node
/**
 * Adapt a curated set of oh-my-pi themes (https://github.com/can1357/oh-my-pi, MIT) for this package.
 *
 * Usage: node scripts/import-omp-themes.mjs <oh-my-pi checkout>
 *
 * For each theme in CURATED it writes:
 * - themes/<name>.json: the theme under its new name, without the color keys that pi's schema rejects,
 *   with the contrast fixes listed in CURATED.
 * - extensions/warm-ui/palettes/curated.json: the theme's status line colors (omp's statusLine* tokens).
 * - terminal/windows-terminal.json, terminal/ghostty-<name>, terminal/kitty-<name>.conf: the matching terminal scheme.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * omp theme -> new name, color fixes and status line fixes. The fixes bring every pair up to the package
 * standard: body text 7:1, secondary text and tool output 4.5:1, status colors 3:1 on their background.
 */
const CURATED = {
	mahogany: {
		name: "warm-mahogany",
		label: "Warm Mahogany",
		colors: { error: "#c0626f" },
		// omp draws this band in the terminal background color, so the pill would not show.
		status: { bg: "#2b221d", sep: "#5a4a40" },
	},
	"dark-gruvbox": { name: "warm-gruvbox", label: "Warm Gruvbox", colors: { muted: "#a89984", toolOutput: "#bdae93" } },
	"light-sand": {
		name: "warm-sand",
		label: "Warm Sand",
		colors: { mdCode: "#7a5c52", warning: "#a86f00" },
		// A warm band instead of gray, and darker status colors: omp's reach only 1.8-2.6:1 on it.
		status: {
			bg: "#efe4d0",
			gitDirty: "#a86f00",
			dirty: "#b35900",
			untracked: "#0277bd",
			output: "#ad1457",
			cost: "#6d4c41",
			model: "#a85a00",
			subagents: "#a85a00",
		},
	},
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ompRoot = process.argv[2];
if (!ompRoot) {
	console.error("usage: node scripts/import-omp-themes.mjs <oh-my-pi checkout>");
	process.exit(1);
}
const source = path.join(ompRoot, "packages/tui/src/theme/defaults");
const PI_SCHEMA =
	"https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json";

// Color keys that pi 1.0 accepts. Every other key fails pi's theme validation.
const PI_COLORS = new Set([
	"accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
	"thinkingText", "selectedBg", "scrollbarTrack", "scrollbarThumb", "searchMatchBg", "searchMatchText",
	"userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel",
	"toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
	"mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder",
	"mdHr", "mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
	"syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber",
	"syntaxType", "syntaxOperator", "syntaxPunctuation",
	"thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh",
	"thinkingMax", "bashMode",
]);

// omp status line token -> palette key used by the footer.
const STATUS_KEYS = {
	statusLineBg: "bg",
	statusLineSep: "sep",
	statusLineModel: "model",
	statusLinePath: "path",
	statusLineGitClean: "gitClean",
	statusLineGitDirty: "gitDirty",
	statusLineStaged: "staged",
	statusLineDirty: "dirty",
	statusLineUntracked: "untracked",
	statusLineSpend: "spend",
	statusLineOutput: "output",
	statusLineCost: "cost",
	statusLineContext: "context",
	statusLineSubagents: "subagents",
};

const ANSI_KEYS = ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white",
	"brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightPurple", "brightCyan", "brightWhite"];
const XTERM_16 = ["#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
	"#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"];

/** Follow variable references. Returns a hex string, a 256-color index, or "" (terminal default). */
function resolve(value, vars, seen = new Set()) {
	if (typeof value === "number" || value === "" || (typeof value === "string" && value.startsWith("#"))) return value;
	if (typeof value !== "string" || !(value in vars) || seen.has(value)) throw new Error(`cannot resolve ${value}`);
	seen.add(value);
	return resolve(vars[value], vars, seen);
}

function indexToHex(n) {
	if (n < 16) return XTERM_16[n];
	if (n < 232) {
		const i = n - 16;
		const level = (v) => (v === 0 ? 0 : 55 + v * 40);
		return `#${[Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((v) => level(v).toString(16).padStart(2, "0")).join("")}`;
	}
	const g = (8 + (n - 232) * 10).toString(16).padStart(2, "0");
	return `#${g}${g}${g}`;
}

const toHex = (value) => (typeof value === "number" ? indexToHex(value) : value);

/** pi has no alpha channel. Composite "#rrggbbaa" over the theme background. */
function flatten(value, bgHex) {
	if (typeof value !== "string" || !/^#[0-9a-f]{8}$/i.test(value)) return value;
	const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	const alpha = ch(value, 3) / 255;
	const bg = /^#[0-9a-f]{6}$/i.test(bgHex) ? bgHex : "#000000";
	const mix = [0, 1, 2].map((i) => Math.round(ch(value, i) * alpha + ch(bg, i) * (1 - alpha)));
	return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Minimum contrast against the terminal background. Code, diffs and headings are text, so they get 4.5:1.
const MIN_CONTRAST = {
	text: 7, userMessageText: 7, muted: 4.5, toolOutput: 4.5, toolTitle: 4.5,
	toolDiffAdded: 4.5, toolDiffRemoved: 4.5, mdHeading: 4.5, mdLink: 4.5, mdCode: 4.5, mdListBullet: 4.5,
	syntaxKeyword: 4.5, syntaxFunction: 4.5, syntaxVariable: 4.5, syntaxString: 4.5, syntaxNumber: 4.5,
	syntaxType: 4.5, syntaxOperator: 4.5, syntaxPunctuation: 4.5,
	syntaxComment: 3, toolDiffContext: 3, dim: 3, accent: 3, success: 3, error: 3, warning: 3,
};

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
function luminance(hex) {
	const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const [r, g, b] = hexToRgb(hex).map(f);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

/** Move a color toward white (dark background) or black (light background) until it reaches min contrast. */
function ensureContrast(hex, bg, min) {
	if (contrast(hex, bg) >= min) return hex;
	const target = luminance(bg) < 0.2 ? [1, 1, 1] : [0, 0, 0];
	const rgb = hexToRgb(hex);
	for (let t = 0.02; t <= 1; t += 0.02) {
		const next = rgbToHex(rgb.map((v, i) => v + (target[i] - v) * t));
		if (contrast(next, bg) >= min) return next;
	}
	return rgbToHex(target);
}

const palettes = {};
const wtFile = path.join(root, "terminal/windows-terminal.json");
const schemes = JSON.parse(fs.readFileSync(wtFile, "utf-8"));

for (const [ompName, pick] of Object.entries(CURATED)) {
	const omp = JSON.parse(fs.readFileSync(path.join(source, `${ompName}.json`), "utf-8"));
	const rawVars = omp.vars ?? {};
	const bgHex = toHex(resolve(omp.terminal.background, rawVars));
	const vars = Object.fromEntries(Object.entries(rawVars).map(([key, value]) => [key, flatten(value, bgHex)]));
	const colors = Object.fromEntries(
		Object.entries(omp.colors)
			.filter(([key]) => PI_COLORS.has(key))
			.map(([key, value]) => [key, flatten(value, bgHex)]),
	);
	Object.assign(colors, pick.colors);
	for (const [key, min] of Object.entries(MIN_CONTRAST)) {
		const value = toHex(resolve(colors[key], vars));
		if (value && /^#[0-9a-f]{6}$/i.test(value)) {
			const fixed = ensureContrast(value, bgHex, min);
			if (fixed !== value) colors[key] = fixed;
		}
	}
	const theme = { $schema: PI_SCHEMA, name: pick.name, vars, colors };
	if (omp.export) theme.export = omp.export;
	fs.writeFileSync(path.join(root, "themes", `${pick.name}.json`), `${JSON.stringify(theme, null, "\t")}\n`);

	const palette = {
		...Object.fromEntries(
			Object.entries(STATUS_KEYS).map(([token, key]) => [key, flatten(resolve(omp.colors[token], vars), bgHex)]),
		),
		...pick.status,
	};
	// Status colors need 3:1 on the band. The separator is decoration and keeps its color.
	const band = toHex(palette.bg) || bgHex;
	for (const [key, value] of Object.entries(palette)) {
		if (key === "bg" || key === "sep" || value === "") continue;
		palette[key] = ensureContrast(toHex(value), band, 3);
	}
	palettes[pick.name] = palette;

	const t = omp.terminal;
	const fg = toHex(resolve(t.foreground, vars));
	const scheme = { name: pick.label, background: bgHex, foreground: fg };
	t.ansi.forEach((value, i) => {
		scheme[ANSI_KEYS[i]] = toHex(resolve(value, vars)) || fg;
	});
	scheme.cursorColor = toHex(resolve(omp.colors.accent, vars)) || fg;
	scheme.selectionBackground = toHex(resolve(omp.colors.selectedBg, vars)) || scheme.brightBlack;
	const at = schemes.findIndex((s) => s.name === scheme.name);
	if (at >= 0) schemes[at] = scheme;
	else schemes.push(scheme);

	const ghostty = [`background = ${scheme.background}`, `foreground = ${scheme.foreground}`, `cursor-color = ${scheme.cursorColor}`,
		`selection-background = ${scheme.selectionBackground}`, ...ANSI_KEYS.map((k, i) => `palette = ${i}=${scheme[k]}`)];
	fs.writeFileSync(path.join(root, "terminal", `ghostty-${pick.name}`), `${ghostty.join("\n")}\n`);
	const kitty = [`background ${scheme.background}`, `foreground ${scheme.foreground}`, `cursor ${scheme.cursorColor}`,
		`selection_background ${scheme.selectionBackground}`, ...ANSI_KEYS.map((k, i) => `color${i} ${scheme[k]}`)];
	fs.writeFileSync(path.join(root, "terminal", `kitty-${pick.name}.conf`), `${kitty.join("\n")}\n`);
}

fs.mkdirSync(path.join(root, "extensions/warm-ui/palettes"), { recursive: true });
fs.writeFileSync(path.join(root, "extensions/warm-ui/palettes/curated.json"), `${JSON.stringify(palettes, null, "\t")}\n`);
fs.writeFileSync(wtFile, `${JSON.stringify(schemes, null, 2)}\n`);
console.log(`adapted: ${Object.values(CURATED).map((c) => c.name).join(", ")}`);
