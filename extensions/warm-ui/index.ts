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
	if (config.tools) pi.registerToolRenderer(createToolResolver(() => shared.enabled));
	if (config.userMessages) installUserMessageBar({ enabled: () => shared.enabled, theme: () => theme?.() });

	// Footer state that outlives one render: git status and running subagent calls.
	let requestRender = () => {};
	let git: GitTracker | undefined;
	const running = new Map<string, number>();
	const agents = () => [...running.values()].reduce((a, b) => a + b, 0);

	// Keep the panel mounted while idle. A user request may contain many model turns: retain its tool
	// rows until the next agent_start, and animate for the whole run rather than only during tools.
	const panelStore = createAgentPanelStore();
	let panelMounted = false;
	let requestPanelRender = () => {};
	// The factory gets the theme proxy from pi, so the panel follows a theme switch without a palette hook.
	const panelFactory = createAgentPanel({
		store: panelStore, config,
		onRender: (request) => (requestPanelRender = request),
	});
	const syncPanel = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		if (!shared.enabled || !config.enabled || !config.agentPanel) {
			if (panelMounted) ctx.ui.setWidget(AGENT_PANEL_KEY, undefined);
			panelMounted = false;
			return;
		}
		// Replacing a widget disposes its component and animation timer. Mount once, then only redraw.
		if (!panelMounted) {
			ctx.ui.setWidget(AGENT_PANEL_KEY, panelFactory, { placement: "aboveEditor" });
			panelMounted = true;
		}
		requestPanelRender();
	};

	const applyLayout = (ctx: ExtensionContext) => {
		// pi shows this label in place of collapsed thinking blocks (hideThinkingBlock). undefined restores "Thinking...".
		const thinkingIcon = icons(config.icons).hiddenThinking;
		ctx.ui.setHiddenThinkingLabel(shared.enabled && thinkingIcon ? `${thinkingIcon} Thinking...` : undefined);
		if (!shared.enabled || !config.enabled) {
			git?.stop();
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
			syncPanel(ctx);
			return;
		}
		git ??= new GitTracker(pi, () => ctx.sessionManager.getCwd(), () => requestRender());
		git.start(10_000);
		ctx.ui.setFooter(createFooter(ctx, { config, git, agents, onRender: (r) => (requestRender = r) }));
		ctx.ui.setEditorComponent(createEditor(pi, ctx, config));
		syncPanel(ctx);
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = () => ctx.ui.theme;
		running.clear();
		panelStore.clear();
		panelMounted = false;
		applyLayout(ctx);
	});

	pi.on("session_shutdown", () => {
		git?.stop();
		git = undefined;
		// pi invalidates ctx right after this event. Renders and callbacks that run later must not read it.
		theme = undefined;
		requestRender = () => {};
		requestPanelRender = () => {};
		panelMounted = false;
		panelStore.clear();
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		panelStore.begin(Date.now());
		syncPanel(ctx);
	});
	// agent_end can be followed by automatic continuation. Only the final settled boundary freezes
	// the rainbow and stops any tool row that was interrupted before emitting its end event.
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		panelStore.settle(Date.now());
		requestPanelRender();
	});
	pi.on("turn_end", () => {
		git?.refresh();
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (["bash", "edit", "write", "powershell"].includes(event.toolName)) git?.refresh();
		if (running.delete(event.toolCallId)) requestRender();
		if (ctx.mode === "tui" && panelStore.calls.has(event.toolCallId)) {
			panelStore.end(event, Date.now());
			requestPanelRender();
		}
	});

	// Count subagent runs: a parallel call runs one agent per task. Background runs return at once and are not counted.
	pi.on("tool_execution_start", (event, ctx) => {
		const args = event.args ?? {};
		if (ctx.mode === "tui") {
			// cwd is captured at start, so a render never reads the event's potentially stale context.
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
				// On shows the panel even before the first call; off removes it immediately.
				syncPanel(ctx);
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
