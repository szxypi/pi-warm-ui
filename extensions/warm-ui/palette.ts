/**
 * Status bar colors per theme, in the format of oh-my-pi's statusLine* tokens.
 *
 * pi's theme schema rejects extra color keys, so these colors live next to the extension:
 * palettes/warm.json for this package's themes, palettes/curated.json for the themes adapted from oh-my-pi.
 * A theme without an entry gets colors derived from its standard tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Color, parseColor } from "@earendil-works/pi-tui";

export interface Palette {
	/** Band background. Undefined means the terminal background (no band). */
	bg?: Color;
	sep: Color;
	model: Color;
	path: Color;
	gitClean: Color;
	gitDirty: Color;
	staged: Color;
	dirty: Color;
	untracked: Color;
	spend: Color;
	output: Color;
	cost: Color;
	context: Color;
	subagents: Color;
}

type RawPalette = Record<keyof Palette, string | number>;

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "palettes");
let raw: Record<string, RawPalette> | undefined;

function loadRaw(): Record<string, RawPalette> {
	if (raw) return raw;
	raw = {};
	for (const file of ["curated.json", "warm.json"]) {
		try {
			Object.assign(raw, JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")));
		} catch {
			// A missing palette file only removes theme-specific colors.
		}
	}
	return raw;
}

function derive(theme: Theme): Palette {
	const c = theme.colors;
	return {
		bg: c.selectedBg,
		sep: c.borderMuted,
		model: c.accent,
		path: c.syntaxFunction,
		gitClean: c.success,
		gitDirty: c.warning,
		staged: c.success,
		dirty: c.warning,
		untracked: c.syntaxType,
		spend: c.syntaxType,
		output: c.syntaxKeyword,
		cost: c.syntaxNumber,
		context: c.muted,
		subagents: c.accent,
	};
}

const cache = new WeakMap<Theme, Palette>();

export function paletteFor(theme: Theme): Palette {
	const hit = cache.get(theme);
	if (hit) return hit;
	const fallback = derive(theme);
	const entry = theme.name ? loadRaw()[theme.name] : undefined;
	let palette = fallback;
	if (entry) {
		palette = { ...fallback };
		for (const [key, value] of Object.entries(entry) as [keyof Palette, string | number][]) {
			if (value === "") {
				// "" is the terminal default: no band background, default text color for the rest.
				if (key === "bg") palette.bg = undefined;
				continue;
			}
			try {
				palette[key] = parseColor(value);
			} catch {
				// Keep the derived color for a value pi cannot parse.
			}
		}
	}
	cache.set(theme, palette);
	return palette;
}
