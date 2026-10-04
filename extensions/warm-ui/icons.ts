import type { IconSet } from "./config.ts";

export interface Icons {
	dir: string;
	branch: string;
	session: string;
	up: string;
	down: string;
	cache: string;
	cost: string;
	context: string;
	model: string;
	thinking: string;
	/** Before pi's "Thinking..." label for collapsed thinking blocks. */
	hiddenThinking: string;
	bash: string;
	subagents: string;
	ahead: string;
	behind: string;
	/** Separator between segments inside the band. */
	sep: string;
	/** Rounded ends of the band. Empty for square ends. */
	capLeft: string;
	capRight: string;
	/** Space between an icon and its value. Plain symbols such as "$" and "↑" stick to the value. */
	gap: string;
}

// Nerd Fonts v3 code points: fa-folder_open, oct-git_branch, fa-bookmark, md-arrow_up_bold, md-arrow_down_bold,
// fa-database, fa-dollar, fa-microchip, md-robot, md-brain, fa-terminal, fa-users,
// powerline thin separator and rounded caps (E0B1, E0B6, E0B4).
const NERD: Icons = {
	dir: "\uF07C",
	branch: "\uF418",
	session: "\uF02E",
	up: "\u{F0737}",
	down: "\u{F072E}",
	cache: "\uF1C0",
	cost: "\uF155",
	context: "\uF2DB",
	model: "\u{F06A9}",
	thinking: "\u{F09D1}",
	hiddenThinking: "\u{F09D1}",
	bash: "\uF120",
	subagents: "\uF0C0",
	ahead: "▴",
	behind: "▾",
	sep: "\uE0B1",
	capLeft: "\uE0B6",
	capRight: "\uE0B4",
	gap: " ",
};

const UNICODE: Icons = {
	dir: "",
	branch: "⎇",
	session: "·",
	up: "↑",
	down: "↓",
	cache: "cache",
	cost: "$",
	context: "ctx",
	model: "",
	thinking: "",
	hiddenThinking: "✻",
	bash: "",
	subagents: "agents",
	ahead: "▴",
	behind: "▾",
	sep: "│",
	capLeft: "",
	capRight: "",
	gap: "",
};

const NONE: Icons = { ...UNICODE, branch: "", session: "·", hiddenThinking: "" };

export function icons(set: IconSet): Icons {
	return set === "nerd" ? NERD : set === "none" ? NONE : UNICODE;
}

/** "icon value", or just the value when the set has no icon for it. Labels such as "cache" always get a space. */
export function withIcon(icon: string, value: string, gap: string): string {
	if (!icon) return value;
	return /^[a-z]/i.test(icon) ? `${icon} ${value}` : `${icon}${gap}${value}`;
}
