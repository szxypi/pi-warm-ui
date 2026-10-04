import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { displayPath, firstLine, str } from "./format.ts";

/** "cd <cwd> && cmd" -> "cmd" when the cd target is the working directory. */
export function stripCd(command: string, cwd: string): string {
	const match = command.match(/^\s*cd\s+(["']?)([^"'&;]+?)\1\s*&&\s*/);
	if (!match) return command;
	const target = match[2].trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
	return path.resolve(cwd, target) === path.resolve(cwd) ? command.slice(match[0].length) : command;
}

/**
 * The one-line summary after the tool name, for the tools this package knows.
 * Returns undefined for other tools, which keep their own call rendering.
 */
export function describeTool(name: string, args: any, cwd: string, theme: Theme): string | undefined {
	const p = (value: unknown) => displayPath(str(value) ?? ".", cwd);
	switch (name) {
		case "bash":
		case "powershell": {
			const command = str(args?.command);
			if (command === undefined) return theme.fg("dim", "…");
			const { line, more } = firstLine(stripCd(command, cwd));
			let text = theme.fg("text", line);
			if (more > 0) text += theme.fg("dim", `  +${more} lines`);
			if (args?.timeout) text += theme.fg("dim", `  timeout ${args.timeout}s`);
			return text;
		}
		case "read": {
			let text = theme.fg("text", p(args?.path ?? args?.file_path));
			const offset = typeof args?.offset === "number" ? args.offset : undefined;
			const limit = typeof args?.limit === "number" ? args.limit : undefined;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				text += theme.fg("dim", limit !== undefined ? `:${start}-${start + limit - 1}` : `:${start}`);
			}
			return text;
		}
		case "edit":
			return theme.fg("text", p(args?.path ?? args?.file_path));
		case "write": {
			const content = str(args?.content);
			const lines = content ? content.replace(/\n$/, "").split("\n").length : 0;
			return theme.fg("text", p(args?.path ?? args?.file_path)) + (lines ? theme.fg("dim", `  ${lines} lines`) : "");
		}
		case "grep": {
			let text = theme.fg("text", `/${str(args?.pattern) ?? ""}/`);
			if (str(args?.glob)) text += theme.fg("dim", ` ${args.glob}`);
			return text + theme.fg("dim", ` in ${p(args?.path)}`);
		}
		case "find":
			return theme.fg("text", str(args?.pattern) ?? "*") + theme.fg("dim", ` in ${p(args?.path)}`);
		case "ls":
			return theme.fg("text", p(args?.path));
		default:
			return undefined;
	}
}

/** A compact JSON preview of arguments for tools without their own renderer. */
export function previewArgs(args: unknown, theme: Theme): string {
	let text: string;
	try {
		text = JSON.stringify(args) ?? "";
	} catch {
		text = "";
	}
	if (text === "{}" || !text) return "";
	return theme.fg("dim", text.length > 120 ? `${text.slice(0, 117)}…` : text);
}

