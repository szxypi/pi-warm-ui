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
	bash: string;
	/** Space between an icon and its value. Plain symbols such as "$" and "↑" stick to the value. */
	gap: string;
}

// Nerd Fonts v3 code points: fa-folder_open, oct-git_branch, fa-bookmark, md-arrow_up_bold, md-arrow_down_bold,
// fa-database, fa-dollar, fa-microchip, md-robot, md-brain, fa-terminal.
const NERD: Icons = {
	dir: "",
	branch: "",
	session: "",
	up: "\u{F0737}",
	down: "\u{F072E}",
	cache: "",
	cost: "",
	context: "",
	model: "\u{F06A9}",
	thinking: "\u{F09D1}",
	bash: "",
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
	bash: "",
	gap: "",
};

const NONE: Icons = { ...UNICODE, branch: "", session: "·" };

export function icons(set: IconSet): Icons {
	return set === "nerd" ? NERD : set === "none" ? NONE : UNICODE;
}

/** "icon value", or just the value when the set has no icon for it. Labels such as "cache" always get a space. */
export function withIcon(icon: string, value: string, gap: string): string {
	if (!icon) return value;
	return /^[a-z]/i.test(icon) ? `${icon} ${value}` : `${icon}${gap}${value}`;
}
