#!/usr/bin/env node
// Input-dock alignment, rainbow rendering and the panel's real extension-event lifecycle.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-layout-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
fs.writeFileSync(path.join(agentDir, "warm-ui.json"), JSON.stringify({
	tools: false, userMessages: false, agentPanel: true, statusBar: "panel", modelLabel: false,
}));
const { loadTs } = await import("./lib/pi-resolve.mjs");
const { loadTheme, makeFooter, BASE, THEMES, ICONS, visibleWidth, stripTerminalSequences: plain } = await import("./lib/fixtures.mjs");
const ap = await loadTs(path.join(REPO, "extensions/warm-ui/agent-panel.ts"));
const { createEditor } = await loadTs(path.join(REPO, "extensions/warm-ui/editor.ts"));
const { icons } = await loadTs(path.join(REPO, "extensions/warm-ui/icons.ts"));
const { default: extension } = await loadTs(path.join(REPO, "extensions/warm-ui/index.ts"));
const theme = loadTheme(REPO, "eyecare-warm");
const NOW = 1_700_000_000_000;
const config = { icons: "nerd", prompt: "❯", modelLabel: false };
const pi = { getThinkingLevel: () => "max" };
const ctx = { model: { id: "glm-5.3", reasoning: true }, ui: { theme } };
const tui = { terminal: { rows: 40 }, requestRender() {} };
const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const keybindings = { matches: () => false, getKeys: () => [] };
const call = { id: "x", name: "bash", args: { command: "echo 彩虹 🌈" }, cwd: "/tmp", status: "done", startedAt: NOW, durationMs: 250 };
const input = (extra = {}) => ({
	width: 100, calls: [call], collapsed: false, now: NOW,
	theme, ic: icons("nerd"), showAgentIcon: true, ...extra,
});
let checks = 0;
const checkWidth = (lines, width) => {
	for (const line of lines) {
		assert.equal(visibleWidth(line), Math.max(0, Math.floor(width)), JSON.stringify(plain(line)));
		checks++;
	}
};

try {
	// The panel, input borders and footer must end in the very same terminal column at all widths.
	for (const themeName of THEMES) {
		const th = loadTheme(REPO, themeName);
		for (const iconSet of ICONS) {
			const footer = await makeFooter({ extDir: path.join(REPO, "extensions"), repo: REPO, themeName, icons: iconSet, statusBar: "panel", scenario: BASE });
			for (const prompt of ["❯", "", "🌈"]) {
				const editor = createEditor(pi, { ...ctx, ui: { theme: th } }, { ...config, icons: iconSet, prompt })(tui, editorTheme, keybindings);
				for (const padding of [0, 1, 3]) {
					editor.setPaddingX(padding);
					for (const text of ["", "对齐输入框 🌈", "!echo test", "long wrapped input ".repeat(20)]) {
						editor.setText(text);
						for (const width of [0, 1, 7, 13, 23, 24, 29, 30, 60, 99, 100, 100.9, 228]) {
							// Pi's base Editor cannot wrap a double-width grapheme into a one-column body.
							// Exercise those terminal slivers with an empty editor, and CJK/emoji at >= 14.
							editor.setText(width < 14 ? "" : text);
							const lines = editor.render(width);
							checkWidth(lines, width);
							const panelLines = ap.renderAgentPanel(input({ width, theme: th, ic: icons(iconSet) }));
							checkWidth(panelLines, width);
							if (width >= 24) {
								const footerLines = footer.render(width).slice(0, 3);
								checkWidth(footerLines, width);
								assert.ok(plain(lines[0]).startsWith("─"));
								assert.ok(plain(footerLines[0]).startsWith("╭"));
								assert.ok(plain(footerLines[0]).endsWith("╮"));
							}
						}
					}
				}
			}
		}
	}
	console.log(`Alignment: ${checks} exact-width rows passed (5 themes, 3 icon sets, prompts, padding, CJK/emoji, wraps and resizes)`);

	// Running rainbow changes; idle rainbow remains byte-for-byte stable even on unrelated redraws.
	const a = ap.renderAgentPanel(input({ running: true, now: NOW }));
	const b = ap.renderAgentPanel(input({ running: true, now: NOW + ap.AGENT_PANEL_FRAME_MS }));
	assert.notEqual(a[0], b[0]);
	assert.deepEqual(a.map(plain), b.map(plain));
	const colorRuns = [...a.at(-1).matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)];
	assert.equal(new Set(colorRuns.map((m) => m[1])).size, 7);
	const idle = ap.renderAgentPanel(input({ running: false, now: NOW }));
	assert.deepEqual(idle, ap.renderAgentPanel(input({ running: false, now: NOW + 12345 })));
	const store = ap.createAgentPanelStore();
	store.begin(NOW);
	assert.equal(store.running(), true, "thinking without a tool is still active");
	store.start({ toolCallId: "x", toolName: "bash", args: {} }, "/tmp", NOW);
	store.end({ toolCallId: "x", isError: false }, NOW + 200);
	assert.equal(store.running(), true, "text streaming after the last tool is still active");
	store.start({ toolCallId: "interrupted", toolName: "read", args: {} }, "/tmp", NOW + 200);
	store.settle(NOW + 350);
	assert.equal(store.running(), false);
	assert.equal(store.size(), 2, "settlement keeps the calls");
	assert.equal(store.calls.get("interrupted").status, "stopped", "interrupt must not report success");
	assert.equal(store.phase(NOW + 99999), store.phase(NOW + 350));
	store.collapsed = true;
	store.begin(NOW + 1000);
	assert.equal(store.size(), 0);
	assert.equal(store.collapsed, true);
	// Compact/collapsed borders retain both corners rather than being clipped by a long count.
	for (let width = 2; width <= 240; width++) {
		for (const collapsed of [false, true]) {
			const lines = ap.renderAgentPanel(input({ width, collapsed, calls: Array(1200).fill(call) }));
			checkWidth(lines, width);
			assert.ok(plain(lines[0]).startsWith("╭"));
			assert.ok(plain(lines[0]).endsWith("╮"));
		}
	}
	console.log("Rainbow/store: all 7 colors, active motion, idle freeze, narrow frames and interrupted-call retention passed");

	// Fake only the host UI/timers: drive the actual index.ts handlers, not a duplicate lifecycle.
	const originalInterval = globalThis.setInterval;
	const originalClear = globalThis.clearInterval;
	const originalNow = Date.now;
	const timers = new Map();
	let now = NOW;
	Date.now = () => now;
	globalThis.setInterval = (fn, ms) => {
		const id = { unref() {} };
		timers.set(id, { fn, ms });
		return id;
	};
	globalThis.clearInterval = (id) => timers.delete(id);
	const handlers = new Map();
	const commands = new Map();
	let widget;
	let mounts = 0;
	let redraws = 0;
	const host = {
		on(name, fn) { handlers.set(name, fn); },
		registerCommand(name, command) { commands.set(name, command); },
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		getThinkingLevel: () => "max",
	};
	const live = {
		mode: "tui", model: ctx.model, thinkingLevel: "max",
		sessionManager: { getCwd: () => "/tmp", getEntries: () => [], getSessionName: () => undefined },
		ui: {
			theme, setHiddenThinkingLabel() {}, setFooter() {}, setEditorComponent() {}, notify() {},
			setWidget(_key, factory) {
				widget?.dispose?.();
				widget = factory?.({ ...tui, requestRender() { redraws++; } }, theme);
				if (factory) mounts++;
			},
		},
	};
	const emit = async (name, event = {}) => handlers.get(name)?.(event, live);
	const tick = () => { for (const { fn } of timers.values()) fn(); };
	try {
		extension(host);
		await emit("session_start");
		assert.ok(widget, "panel is visible before any tool runs");
		assert.equal(mounts, 1);
		const before = redraws;
		tick();
		assert.equal(redraws, before, "idle timer does not request renders");
		await emit("agent_start");
		const activeA = widget.render(100)[0];
		now += ap.AGENT_PANEL_FRAME_MS;
		tick();
		assert.ok(redraws > before);
		assert.notEqual(widget.render(100)[0], activeA, "thinking-only run animates");
		await emit("tool_execution_start", { toolCallId: "a", toolName: "bash", args: { command: "sleep 1" } });
		await emit("tool_execution_end", { toolCallId: "a", toolName: "bash", isError: false, durationMs: 250 });
		await emit("turn_end");
		assert.ok(widget.render(100).map(plain).join("\n").includes("✓ bash"), "turn_end keeps rows");
		await emit("tool_execution_start", { toolCallId: "b", toolName: "read", args: { path: "file.ts" } });
		await emit("tool_execution_end", { toolCallId: "b", toolName: "read", isError: false, durationMs: 100 });
		assert.equal(mounts, 1, "tool events redraw, never remount the widget/timer");
		await emit("agent_end");
		await emit("agent_start");
		assert.ok(widget.render(100).map(plain).join("\n").includes("✓ bash"), "automatic continuation keeps calls until settlement");
		now += ap.AGENT_PANEL_FRAME_MS;
		const beforeSettle = widget.render(100);
		now += ap.AGENT_PANEL_FRAME_MS;
		assert.notDeepEqual(widget.render(100), beforeSettle, "agent_end alone must not freeze automatic continuation");
		await emit("agent_settled");
		const frozen = widget.render(100);
		const stoppedRedraws = redraws;
		now += 12345;
		tick();
		assert.equal(redraws, stoppedRedraws);
		assert.deepEqual(widget.render(100), frozen, "settled border freezes, including on unrelated redraws");
		await commands.get("warm-ui").handler("agent-panel off", live);
		assert.equal(widget, undefined);
		await commands.get("warm-ui").handler("agent-panel on", live);
		assert.ok(widget);
		await commands.get("warm-ui").handler("off", live);
		assert.equal(widget, undefined);
		await commands.get("warm-ui").handler("on", live);
		assert.ok(widget);
		await emit("agent_start");
		assert.equal(widget.render(100).map(plain).join("\n").includes("bash"), false, "next request clears old calls");
		await emit("agent_settled");
		await emit("session_shutdown");
		widget?.dispose?.(); // Pi removes widgets while resetting extension UI.
		widget = undefined;
		assert.equal(timers.size, 0, "shutdown/reset disposes all timers");
		await emit("session_start");
		assert.ok(widget, "new session remounts an empty idle panel");
		await emit("session_shutdown");
		widget?.dispose?.();
		assert.equal(timers.size, 0);
		console.log("Lifecycle: persistent idle/turn-end/settled panel, text-only animation, toggles and session cleanup passed");
	} finally {
		globalThis.setInterval = originalInterval;
		globalThis.clearInterval = originalClear;
		Date.now = originalNow;
	}
} finally {
	fs.rmSync(agentDir, { recursive: true, force: true });
}
