import os from "node:os";
import path from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function formatDuration(ms: number): string {
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${Math.floor(s % 60)}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Replace the home directory with "~". */
export function formatCwd(cwd: string): string {
	const home = os.homedir();
	if (cwd === home) return "~";
	return cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
}

/** A path relative to cwd when it is inside cwd, else the "~" form. */
export function displayPath(p: string, cwd: string): string {
	if (!path.isAbsolute(p)) return p;
	const rel = path.relative(cwd, p);
	if (rel === "") return ".";
	if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
	return formatCwd(p);
}

/** Replace middle segments with "…" until the path fits in max columns. */
export function shortenPath(p: string, max: number): string {
	const segs = p.split(path.sep);
	while (visibleWidth(segs.join(path.sep)) > max && segs.length > 3) {
		segs.splice(1, segs[1] === "…" ? 2 : 1, "…");
	}
	return segs.join(path.sep);
}

/** Put left and right on one line. If they do not fit, truncate left first, then right. */
export function spread(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width, "…");
	const gap = 2;
	const rw = visibleWidth(right);
	if (rw + gap >= width) return truncateToWidth(right, width, "…");
	const l = truncateToWidth(left, width - rw - gap, "…");
	return l + " ".repeat(Math.max(0, width - visibleWidth(l) - rw)) + right;
}

const ANSI = /\x1b\[[0-9;:]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function isBlank(line: string): boolean {
	return line.replace(ANSI, "").trim() === "";
}

/** Drop blank lines at both ends. */
export function trimBlank(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && isBlank(lines[start])) start++;
	while (end > start && isBlank(lines[end - 1])) end--;
	return lines.slice(start, end);
}

export function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** First line of a text, with the number of further lines. */
export function firstLine(text: string): { line: string; more: number } {
	const lines = text.replace(/\r/g, "").trim().split("\n");
	return { line: lines[0] ?? "", more: lines.length - 1 };
}
