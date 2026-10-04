import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Config {
	/** Footer and editor layout. */
	enabled: boolean;
	/** Context meter in the footer. */
	contextMeter: boolean;
	/** Status keys that the footer does not show. */
	hideStatuses: string[];
	/** Compact rows for tool calls, including subagent runs. */
	tools: boolean;
	/** Accent bar on user messages. */
	userMessages: boolean;
	/** Status bar icons: "nerd" needs a Nerd Font, "unicode" uses plain symbols and labels, "none" uses labels only. */
	icons: IconSet;
}

export type IconSet = "nerd" | "unicode" | "none";

// pi-code mirrors the Claude Code statusLine into this status.
// It repeats the model and the context usage that the footer already shows.
const DEFAULTS: Config = {
	enabled: true,
	contextMeter: true,
	hideStatuses: ["pi-code-status"],
	tools: true,
	userMessages: true,
	icons: "unicode",
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
		contextMeter: bool("contextMeter"),
		hideStatuses: Array.isArray(raw.hideStatuses) ? raw.hideStatuses.map(String) : DEFAULTS.hideStatuses,
		tools: bool("tools"),
		userMessages: bool("userMessages"),
		icons: raw.icons === "nerd" || raw.icons === "unicode" || raw.icons === "none" ? raw.icons : DEFAULTS.icons,
	};
}
