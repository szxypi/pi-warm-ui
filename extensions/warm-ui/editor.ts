import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { icons } from "./icons.ts";

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];

/**
 * The editor with "──────── model · level ───" on its bottom border.
 * The top border keeps pi's working status (embedWorkingStatus).
 */
export function createEditor(pi: ExtensionAPI, ctx: ExtensionContext, config: Config): EditorFactory {
	const ic = icons(config.icons);
	const lead = (icon: string) => (icon ? `${icon} ` : "");

	class WarmEditor extends CustomEditor {
		constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
			super(tui, theme, keybindings, { embedWorkingStatus: true });
		}

		// It keeps pi's "↓ N more" border while the text scrolls.
		protected renderBottomBorder(width: number, linesBelow: number): string {
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
