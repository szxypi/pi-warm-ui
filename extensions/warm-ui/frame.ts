import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** All input-dock frames use the same integer terminal-column budget. */
export const frameWidth = (width: number): number => (Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0);

/** Keep a frame on the editor's left/right columns, including after a narrow resize. */
export function fitFrameLines(lines: string[], width: number): string[] {
	const total = frameWidth(width);
	return lines.map((line) => {
		const fitted = visibleWidth(line) > total ? truncateToWidth(line, total, "") : line;
		return fitted + " ".repeat(Math.max(0, total - visibleWidth(fitted)));
	});
}
