import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Config {
	/** Footer and editor layout. */
	enabled: boolean;
	/** Status keys that the footer does not show. */
	hideStatuses: string[];
	/** Compact rows for tool calls, including subagent runs. */
	tools: boolean;
	/** Accent bar on user messages. */
	userMessages: boolean;
	/** Status bar icons: "nerd" needs a Nerd Font, "unicode" uses plain symbols and labels, "none" uses labels only. */
	icons: IconSet;
	/**
	 * Status bar style.
	 * - "band"  colored capsule bands (default, like oh-my-pi)
	 * - "plain" colored text only, no background
	 * - "bar"   full-width solid background row, no caps
	 * - "rail"  no background; left and right groups connected by a dim rule
	 * - "panel" three-row rounded box that fills the width; the border follows the context level
	 */
	statusBar: "band" | "plain" | "bar" | "rail" | "panel";
	/** Symbol before the first input line. "" turns it off. */
	prompt: string;
}

export type IconSet = "nerd" | "unicode" | "none";

// pi-code mirrors the Claude Code statusLine into this status.
// It repeats the model and the context usage that the footer already shows.
const DEFAULTS: Config = {
	enabled: true,
	hideStatuses: ["pi-code-status"],
	tools: true,
	userMessages: true,
	icons: "unicode",
	statusBar: "band",
	prompt: "❯",
};

export function loadConfig(): Config {
	const file = path.join(getAgentDir(), "warm-ui.json");
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return { ...DEFAULTS };
	}
	const bool = (key: keyof Config) => (typeof raw[key] === "boolean" ? (raw[key] as boolean) : (DEFAULTS[key] as boolean));
	return {
		enabled: bool("enabled"),
		hideStatuses: Array.isArray(raw.hideStatuses) ? raw.hideStatuses.map(String) : DEFAULTS.hideStatuses,
		tools: bool("tools"),
		userMessages: bool("userMessages"),
		icons: raw.icons === "nerd" || raw.icons === "unicode" || raw.icons === "none" ? raw.icons : DEFAULTS.icons,
		statusBar:
			raw.statusBar === "band" ||
			raw.statusBar === "plain" ||
			raw.statusBar === "bar" ||
			raw.statusBar === "rail" ||
			raw.statusBar === "panel"
				? raw.statusBar
				: DEFAULTS.statusBar,
		prompt: typeof raw.prompt === "string" ? raw.prompt.replace(/\s+/g, " ").trim() : DEFAULTS.prompt,
	};
}
