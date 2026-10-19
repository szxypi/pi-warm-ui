/**
 * pi-warm-ui: a calm layout for the pi interactive mode.
 *
 * - Editor: a prompt symbol before the input. The bottom border shows the model and the thinking level ("bash" in bash mode).
 *   The top border keeps pi's working status.
 * - Footer: a status bar on a colored band (after oh-my-pi) with the project name, git status,
 *   running subagents, usage and context usage. Colors come from the theme's status line palette.
 * - Tool rows: a status dot, a one-line summary and the output in a gutter. Subagent runs show
 *   one row per run with live progress.
 * - User messages: an accent bar on the left edge. Collapsed thinking blocks get an icon.
 *
 * Configuration: <agent dir>/warm-ui.json (see config.ts). "/warm-ui on|off" switches everything
 * until pi exits. "/warm-ui style band|plain|bar|rail|panel" switches the status bar style for this session.
 * Tool rows that are already drawn keep their style until /reload.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { createAgentPanel, createAgentPanelStore } from "./agent-panel.ts";
import { loadConfig } from "./config.ts";
import { createEditor } from "./editor.ts";
import { createFooter } from "./footer.ts";
import { GitTracker } from "./git.ts";
import { icons } from "./icons.ts";
import { installUserMessageBar } from "./messages.ts";
import { createToolResolver } from "./tools.ts";

const STYLES = ["band", "plain", "bar", "rail", "panel"] as const;
type StatusBarStyle = typeof STYLES[number];

/** The widget key. Setting it to undefined removes the panel. */
const AGENT_PANEL_KEY = "warm-panel";

export default function (pi: ExtensionAPI) {
	// Shared state outlives /reload. Initialised once per pi process.
	const shared = ((globalThis as any)[Symbol.for("pi-warm-ui.state")] ??= {
		enabled: true,
		statusBarOverride: undefined as StatusBarStyle | undefined,
	}) as { enabled: boolean; statusBarOverride: StatusBarStyle | undefined };

	const config = loadConfig();
	// Apply session-level style override (set by /warm-ui style, survives /reload, cleared on pi exit).
	if (shared.statusBarOverride !== undefined) config.statusBar = shared.statusBarOverride;

	let theme: (() => Theme) | undefined;
	// The live extension context. pi marks it stale after /reload and a session switch, so reads are
	// guarded: session_start replaces it and session_shutdown clears it.
	let live: ExtensionContext | undefined;

	if (config.tools) pi.registerToolRenderer(createToolResolver(() => shared.enabled));
	if (config.userMessages) installUserMessageBar({ enabled: () => shared.enabled, theme: () => theme?.() });

	// Footer state that outlives one render: git status and running subagent calls.
	let requestRender = () => {};
	let git: GitTracker | undefined;
	const running = new Map<string, number>();
	const agents = () => [...running.values()].reduce((a, b) => a + b, 0);

	// The agent panel: the tool calls of the current turn, above the input. The store holds the rows so
	// the widget component stays stateless; the panel shows from the first call until the turn ends.
	const panelStore = createAgentPanelStore();
	/** Current model and thinking level, read live so /model and shift+tab show on the next frame. */
	const readModel = (): { model: string; effort: string | undefined } => {
		try {
			const model = live?.model;
			const id = model?.id ?? model?.name ?? "";
			const level = live?.thinkingLevel;
			return { model: id, effort: model?.reasoning && level && level !== "off" ? level : undefined };
		} catch {
			return { model: "", effort: undefined };
		}
	};
	// The factory gets the theme proxy from pi, so the panel follows a theme switch without a palette hook.
	const panelFactory = createAgentPanel({ store: panelStore, config, model: readModel });
	const syncPanel = (ctx: ExtensionContext) => {
		if (!shared.enabled || !config.enabled || !config.agentPanel) {
			ctx.ui.setWidget(AGENT_PANEL_KEY, undefined);
			return;
		}
		// The store keeps the rows; the widget only draws them. Re-setting replaces the old component.
		ctx.ui.setWidget(AGENT_PANEL_KEY, panelFactory, { placement: "aboveEditor" });
	};

	const applyLayout = (ctx: ExtensionContext) => {
		// pi shows this label in place of collapsed thinking blocks (hideThinkingBlock). undefined restores "Thinking...".
		const thinkingIcon = icons(config.icons).hiddenThinking;
		ctx.ui.setHiddenThinkingLabel(shared.enabled && thinkingIcon ? `${thinkingIcon} Thinking...` : undefined);
		if (!shared.enabled || !config.enabled) {
			git?.stop();
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
			ctx.ui.setWidget(AGENT_PANEL_KEY, undefined);
			return;
		}
		git ??= new GitTracker(pi, () => ctx.sessionManager.getCwd(), () => requestRender());
		git.start(10_000);
		ctx.ui.setFooter(createFooter(ctx, { config, git, agents, onRender: (r) => (requestRender = r) }));
		ctx.ui.setEditorComponent(createEditor(pi, ctx, config));
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		live = ctx;
		theme = () => ctx.ui.theme;
		running.clear();
		panelStore.clear();
		applyLayout(ctx);
	});

	pi.on("session_shutdown", () => {
		git?.stop();
		git = undefined;
		// pi invalidates ctx right after this event. Renders and callbacks that run later must not read it.
		live = undefined;
		theme = undefined;
		requestRender = () => {};
		panelStore.clear();
	});

	// Refresh git status after anything that may touch files. The agent panel keeps its rows until the
	// turn ends, then the next turn starts with an empty panel.
	pi.on("turn_end", (_event, ctx) => {
		git?.refresh();
		panelStore.clear();
		ctx.ui.setWidget(AGENT_PANEL_KEY, undefined);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (["bash", "edit", "write", "powershell"].includes(event.toolName)) git?.refresh();
		if (running.delete(event.toolCallId)) requestRender();
		if (config.agentPanel && panelStore.calls.has(event.toolCallId)) {
			panelStore.end(event, Date.now());
			ctx.ui.setWidget(AGENT_PANEL_KEY, panelFactory, { placement: "aboveEditor" });
		}
	});

	// Count subagent runs: a parallel call runs one agent per task. Background runs return at once and are not counted.
	pi.on("tool_execution_start", (event, ctx) => {
		const args = event.args ?? {};
		if (config.agentPanel && shared.enabled && config.enabled) {
			// The panel opens on the first call of the turn. cwd is read here, so a render never reads ctx.
			panelStore.start(event, ctx.sessionManager.getCwd(), Date.now());
			syncPanel(ctx);
		}
		if (event.toolName !== "subagent" || args.status || args.cancel || args.background) return;
		running.set(event.toolCallId, Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks.length : 1);
		requestRender();
	});

	pi.registerCommand("warm-ui", {
		description: "Switch the warm-ui layout on or off, or choose a status bar style, until pi exits",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			// /warm-ui style [band|plain|bar|rail]
			if (arg === "style" || arg.startsWith("style ")) {
				const name = arg.slice("style".length).trim();
				if (!name) {
					const current = shared.statusBarOverride ?? config.statusBar;
					ctx.ui.notify(`status bar style: ${current}\nOptions: ${STYLES.join(" | ")}`, "info");
					return;
				}
				if (!STYLES.includes(name as StatusBarStyle)) {
					ctx.ui.notify(`Unknown style "${name}". Options: ${STYLES.join(" | ")}`, "error");
					return;
				}
				shared.statusBarOverride = name as StatusBarStyle;
				// Update the live config object so the footer re-reads it on the next render frame.
				// No applyLayout needed: footer.ts reads config dynamically on every render call.
				config.statusBar = name as StatusBarStyle;
				requestRender();
				ctx.ui.notify(`Status bar style set to "${name}" for this session.`, "info");
				return;
			}

			// /warm-ui agent-panel [on|off]
			if (arg === "agent-panel" || arg.startsWith("agent-panel ")) {
				const name = arg.slice("agent-panel".length).trim();
				if (!name) {
					ctx.ui.notify(`agent panel: ${config.agentPanel ? "on" : "off"}. Usage: /warm-ui agent-panel on|off`, "info");
					return;
				}
				if (name !== "on" && name !== "off") {
					ctx.ui.notify(`Unknown value "${name}". Usage: /warm-ui agent-panel on|off`, "error");
					return;
				}
				config.agentPanel = name === "on";
				// Off removes the panel at once. On re-mounts it, so the next call of this turn shows again.
				if (config.agentPanel && panelStore.size() > 0) syncPanel(ctx);
				else ctx.ui.setWidget(AGENT_PANEL_KEY, undefined);
				ctx.ui.notify(`Agent panel ${name} for this session.`, "info");
				return;
			}

			if (arg !== "on" && arg !== "off") {
				ctx.ui.notify(
					`warm-ui is ${shared.enabled ? "on" : "off"}. Usage: /warm-ui on|off|style [${STYLES.join("|")}]|agent-panel [on|off]`,
					"info",
				);
				return;
			}
			shared.enabled = arg === "on";
			applyLayout(ctx);
			ctx.ui.notify(`warm-ui ${arg}. Run /reload to redraw earlier tool rows.`, "info");
		},
	});
}
