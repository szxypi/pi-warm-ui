/**
 * pi-warm-ui: a calm layout for the pi interactive mode.
 *
 * - Editor: the bottom border shows the model and the thinking level ("bash" in bash mode).
 *   The top border keeps pi's working status.
 * - Footer: a status bar on a colored band (after oh-my-pi) with the directory, git status,
 *   running subagents, usage and a context meter. Colors come from the theme's status line palette.
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
import { GitTracker } from "./git.ts";
import { installUserMessageBar } from "./messages.ts";
import { createToolResolver } from "./tools.ts";

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	// The on/off switch outlives /reload, which loads a fresh instance of this module.
	const shared = ((globalThis as any)[Symbol.for("pi-warm-ui.state")] ??= { enabled: true }) as { enabled: boolean };
	let theme: (() => Theme) | undefined;

	if (config.tools) pi.registerToolRenderer(createToolResolver(() => shared.enabled));
	if (config.userMessages) installUserMessageBar({ enabled: () => shared.enabled, theme: () => theme?.() });

	// Footer state that outlives one render: git status and running subagent calls.
	let requestRender = () => {};
	let git: GitTracker | undefined;
	const running = new Map<string, number>();
	const agents = () => [...running.values()].reduce((a, b) => a + b, 0);

	const applyLayout = (ctx: ExtensionContext) => {
		if (!shared.enabled || !config.enabled) {
			git?.stop();
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
			return;
		}
		git ??= new GitTracker(pi, () => ctx.sessionManager.getCwd(), () => requestRender());
		git.start(10_000);
		ctx.ui.setFooter(createFooter(ctx, { config, git, agents, onRender: (r) => (requestRender = r) }));
		ctx.ui.setEditorComponent(createEditor(pi, ctx, config));
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = () => ctx.ui.theme;
		running.clear();
		applyLayout(ctx);
	});

	pi.on("session_shutdown", () => {
		git?.stop();
		git = undefined;
	});

	// Refresh git status after anything that may touch files.
	pi.on("turn_end", () => git?.refresh());
	pi.on("tool_execution_end", (event) => {
		if (["bash", "edit", "write", "powershell"].includes(event.toolName)) git?.refresh();
		if (running.delete(event.toolCallId)) requestRender();
	});

	// Count subagent runs: a parallel call runs one agent per task. Background runs return at once and are not counted.
	pi.on("tool_execution_start", (event) => {
		const args = event.args ?? {};
		if (event.toolName !== "subagent" || args.status || args.cancel || args.background) return;
		running.set(event.toolCallId, Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks.length : 1);
		requestRender();
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
