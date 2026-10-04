/**
 * pi-warm-ui: a calm layout for the pi interactive mode.
 *
 * - Editor: the bottom border shows the model and the thinking level ("bash" in bash mode).
 *   The top border keeps pi's working status.
 * - Footer: one line with the working directory, git branch, usage and a context meter.
 * - Tool rows: a status dot, a one-line summary and the output in a gutter. Subagent runs show
 *   one row per run with live progress.
 * - User messages: an accent bar on the left edge.
 *
 * Configuration: <agent dir>/warm-ui.json (see config.ts). "/warm-ui on|off" switches everything
 * until pi exits. Tool rows that are already drawn keep their style until /reload.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { createEditor } from "./editor.ts";
import { createFooter } from "./footer.ts";
import { installUserMessageBar } from "./messages.ts";
import { createToolResolver } from "./tools.ts";

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	// The on/off switch outlives /reload, which loads a fresh instance of this module.
	const shared = ((globalThis as any)[Symbol.for("pi-warm-ui.state")] ??= { enabled: true }) as { enabled: boolean };
	let theme: (() => Theme) | undefined;

	if (config.tools) pi.registerToolRenderer(createToolResolver(() => shared.enabled));
	if (config.userMessages) installUserMessageBar({ enabled: () => shared.enabled, theme: () => theme?.() });

	const applyLayout = (ctx: ExtensionContext) => {
		if (!shared.enabled || !config.enabled) {
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
			return;
		}
		ctx.ui.setFooter(createFooter(ctx, config));
		ctx.ui.setEditorComponent(createEditor(pi, ctx, config));
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = () => ctx.ui.theme;
		applyLayout(ctx);
	});

	pi.registerCommand("warm-ui", {
		description: "Switch the warm-ui layout on or off until pi exits",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg !== "on" && arg !== "off") {
				ctx.ui.notify(`warm-ui is ${shared.enabled ? "on" : "off"}. Usage: /warm-ui on|off`, "info");
				return;
			}
			shared.enabled = arg === "on";
			applyLayout(ctx);
			ctx.ui.notify(`warm-ui ${arg}. Run /reload to redraw earlier tool rows.`, "info");
		},
	});
}
