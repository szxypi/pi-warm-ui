import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { icons } from "./icons.ts";

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];

/**
 * The editor with a prompt symbol before the input and "──────── model · level ───" on its bottom border:
 *
 *   ─────────────────────────────────────────────
 *   ❯ fix the rate limiter
 *     and add a test
 *   ───────────────────── 󰚩 glm-5.3 · 󰧑 high ───
 *
 * The top border keeps pi's working status (embedWorkingStatus).
 */
export function createEditor(pi: ExtensionAPI, ctx: ExtensionContext, config: Config): EditorFactory {
	const ic = icons(config.icons);
	const lead = (icon: string) => (icon ? `${icon} ` : "");
	// The prompt symbol and one space. Wrapped lines and the autocomplete list are indented to match.
	const promptWidth = config.prompt ? visibleWidth(config.prompt) + 1 : 0;

	class WarmEditor extends CustomEditor {
		/** Full width while render() lays out the text in the narrower width beside the prompt. */
		private outerWidth?: number;

		constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
			super(tui, theme, keybindings, { embedWorkingStatus: true });
		}

		private promptShift(width: number): number {
			return promptWidth && width >= promptWidth + 12 ? promptWidth : 0;
		}

		render(width: number): string[] {
			const shift = this.promptShift(width);
			if (!shift) return super.render(width);
			const inner = width - shift;
			let lines: string[];
			this.outerWidth = width;
			try {
				lines = super.render(inner);
			} finally {
				this.outerWidth = undefined;
			}
			// Same padding as Editor.render uses for the inner width. Its left padding is plain spaces.
			const padX = Math.min(this.getPaddingX(), Math.max(0, Math.floor((inner - 1) / 2)));
			const rows = (this as unknown as { renderedVisibleLineCount: number }).renderedVisibleLineCount;
			const input = this.getText().trimStart();
			const symbol = input.startsWith("!") ? this.borderColor(config.prompt) : ctx.ui.theme.fg("accent", config.prompt);
			const indent = " ".repeat(shift);
			return lines.map((line, i) => {
				// Row 0 is the top border and row rows + 1 the bottom border. Both already have the full width.
				if (i === 0 || i === rows + 1) return line;
				const head = i === 1 ? `${symbol} ` : indent;
				return line.slice(0, padX) + head + line.slice(padX);
			});
		}

		handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			const shift = this.promptShift(event.width);
			if (!shift) return super.handleMouse(event);
			return super.handleMouse({ ...event, x: Math.max(0, event.x - shift), width: event.width - shift });
		}

		protected renderTopBorder(width: number, hiddenLineCount: number): string {
			return super.renderTopBorder(this.outerWidth ?? width, hiddenLineCount);
		}

		// It keeps pi's "↓ N more" border while the text scrolls.
		protected renderBottomBorder(innerWidth: number, linesBelow: number): string {
			const width = this.outerWidth ?? innerWidth;
			const model = ctx.model?.id;
			if (linesBelow > 0 || !model) return super.renderBottomBorder(width, linesBelow);
			const theme = ctx.ui.theme;
			const input = this.getText().trimStart();
			let label: string;
			if (input.startsWith("!")) {
				// pi colors the border with bashMode while the input is a shell command.
				label = this.borderColor(lead(ic.bash) + (input.startsWith("!!") ? "bash · no context" : "bash"));
			} else {
				label = (ic.model ? theme.fg("syntaxType", ic.model) + " " : "") + theme.fg("text", model);
				if (ctx.model?.reasoning) {
					const level = pi.getThinkingLevel();
					label += theme.fg("dim", " · ") + this.borderColor(lead(ic.thinking) + (level === "off" ? "thinking off" : level));
				}
			}
			label = ` ${label} `;
			const lw = visibleWidth(label);
			if (lw + 6 > width) return super.renderBottomBorder(width, linesBelow);
			return this.borderColor("─".repeat(width - lw - 3)) + label + this.borderColor("───");
		}
	}

	return (tui, theme, keybindings) => new WarmEditor(tui, theme, keybindings);
}
