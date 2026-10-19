#!/usr/bin/env node
// Agent roster semantics, nesting, exact-column layout, rainbow and real extension-event lifecycle.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-layout-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
fs.writeFileSync(path.join(agentDir, "warm-ui.json"), JSON.stringify({ tools: false, userMessages: false, agentPanel: true, statusBar: "panel", modelLabel: false }));
const { loadTs } = await import("./lib/pi-resolve.mjs");
const { loadTheme, makeFooter, BASE, THEMES, ICONS, visibleWidth, stripTerminalSequences: plain } = await import("./lib/fixtures.mjs");
const ap = await loadTs(path.join(REPO, "extensions/warm-ui/agent-panel.ts"));
const { createEditor } = await loadTs(path.join(REPO, "extensions/warm-ui/editor.ts"));
const { icons } = await loadTs(path.join(REPO, "extensions/warm-ui/icons.ts"));
const { default: extension } = await loadTs(path.join(REPO, "extensions/warm-ui/index.ts"));
const theme = loadTheme(REPO, "eyecare-warm");
const NOW = 1_700_000_000_000;
const config = { icons: "nerd", prompt: "❯", modelLabel: false };
const pi = { getThinkingLevel: () => "xhigh" };
const model = { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", reasoning: true };
const ctx = { model, ui: { theme } };
const tui = { terminal: { rows: 40 }, requestRender() {} };
const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const keybindings = { matches: () => false, getKeys: () => [] };
const main = { id: "main", name: "main", model: "GPT-6.1 Sol", effort: "xhigh", status: "idle" };
const agent = (id, name, extra = {}) => ({ id, name, model: "cpamc/minimax-m3", effort: "high", status: "running", ...extra });
const input = (extra = {}) => ({ width: 100, main, agents: [], collapsed: false, now: NOW, running: false, theme, ic: icons("nerd"), showAgentIcon: true, ...extra });
let checks = 0;
const checkWidth = (lines, width) => {
	for (const line of lines) { assert.equal(visibleWidth(line), Math.max(0, Math.floor(width)), JSON.stringify(plain(line))); checks++; }
};
const text = (lines) => lines.map(plain).join("\n");
try {
	const children = [agent("a", "scout"), agent("a1", "coder", { parentId: "a" }), agent("a11", "reviewer", { parentId: "a1" }), agent("a2", "inspector", { parentId: "a" }), agent("b", "oracle")];
	for (const themeName of THEMES) {
		const th = loadTheme(REPO, themeName);
		for (const iconSet of ICONS) {
			const footer = await makeFooter({ extDir: path.join(REPO, "extensions"), repo: REPO, themeName, icons: iconSet, statusBar: "panel", scenario: BASE });
			for (const prompt of ["❯", "", "🌈"]) {
				const editor = createEditor(pi, { ...ctx, ui: { theme: th } }, { ...config, icons: iconSet, prompt })(tui, editorTheme, keybindings);
				for (const padding of [0, 1, 3]) {
					editor.setPaddingX(padding);
					for (const value of ["", "对齐输入框 🌈", "!echo test", "long wrapped input ".repeat(20)]) {
						for (const width of [0, 1, 7, 13, 23, 24, 29, 30, 60, 99, 100, 100.9, 228]) {
							// The upstream editor cannot wrap a double-width grapheme in one column.
							editor.setText(width < 14 ? "" : value);
							checkWidth(editor.render(width), width);
							checkWidth(ap.renderAgentPanel(input({ width, agents: children, theme: th, ic: icons(iconSet) })), width);
							if (width >= 24) checkWidth(footer.render(width).slice(0, 3), width);
						}
					}
				}
			}
		}
	}
	console.log(`Alignment: ${checks} exact-width rows passed (5 themes, 3 icon sets, CJK/emoji, wraps and resizes)`);

	const idle = ap.renderAgentPanel(input());
	assert.ok(text(idle).includes("main  GPT 6.1 SOL · XHIGH"));
	assert.equal(idle.length, 3, "main is a body row even before the first prompt");
	assert.ok(!plain(idle[0]).includes("main"), "header remains clean");
	for (const collapsed of [false, true]) {
		for (let width = 2; width <= 240; width++) {
			const lines = ap.renderAgentPanel(input({ width, collapsed, agents: children }));
			checkWidth(lines, width);
			assert.ok(plain(lines[0]).startsWith("╭"));
			assert.ok(plain(lines[0]).endsWith("╮"));
		}
	}
	const tree = ap.renderAgentPanel(input({ agents: children })).map(plain);
	assert.ok(tree.find((row) => row.includes("main")).startsWith("│ ● main"));
	assert.ok(tree.find((row) => row.includes("scout")).startsWith("│ ● scout"));
	assert.ok(tree.find((row) => row.includes("oracle")).startsWith("│ ● oracle"));
	assert.ok(tree.find((row) => row.includes("coder")).startsWith("│ ├─ ● coder"));
	assert.ok(tree.find((row) => row.includes("reviewer")).startsWith("│ │  └─ ● reviewer"));
	assert.ok(tree.find((row) => row.includes("inspector")).startsWith("│ └─ ● inspector"));
	const many = Array.from({ length: 12 }, (_, i) => agent(String(i), `child${i}`, { status: i === 2 ? "running" : "done" }));
	const capped = ap.renderAgentPanel(input({ agents: many }));
	assert.equal(capped.length, ap.AGENT_PANEL_MAX_ROWS + 2);
	assert.ok(text(capped).includes("main") && text(capped).includes("child2") && text(capped).includes("… +8 more"));
	const nestedCap = text(ap.renderAgentPanel(input({ agents: [...children, ...many] })));
	if (nestedCap.includes("coder")) assert.ok(nestedCap.includes("scout"), "capped nested row retains its parent");
	if (nestedCap.includes("reviewer  MINIMAX")) assert.ok(nestedCap.includes("coder"), "deep nested row retains every ancestor");
	assert.ok(ap.displayModel("cpamc/gpt-6.1-sol:xhigh") === "GPT 6.1 SOL");
	const a = ap.renderAgentPanel(input({ running: true }));
	const b = ap.renderAgentPanel(input({ running: true, now: NOW + ap.AGENT_PANEL_FRAME_MS }));
	assert.notEqual(a[0], b[0]);
	assert.deepEqual(a.map(plain), b.map(plain));
	assert.equal(new Set([...a.at(-1).matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].map((m) => m[1])).size, 7);
	assert.deepEqual(idle, ap.renderAgentPanel(input({ now: NOW + 12345 })));
	console.log("Roster: main always visible, direct agents flush-left, nested branch lines, row cap and rainbow passed");

	const store = ap.createAgentPanelStore();
	store.start({ toolCallId: "tool", toolName: "bash", args: {} }, NOW);
	assert.equal(store.size(), 0, "ordinary tools must never appear as agents");
	store.begin(NOW);
	store.start({ toolCallId: "s", toolName: "subagent", args: { workflow: "parallel", args: { tasks: [{ agent: "scout" }, { agent: "coder", model: "cpamc/deepseek-flash:max" }] } } }, NOW);
	assert.equal(store.size(), 2);
	assert.equal(store.list()[1].effort, "max");
	store.update("s", { details: { runId: "r", mode: "parallel", results: [
		{ index: 0, agent: "scout", model: "cpamc/minimax-m3", thinking: "low", exitCode: -1, children: [{ id: "nested", state: "running", steps: [{ agent: "reviewer", model: "cpamc/glm-5.3", thinking: "max", status: "running" }] }] },
		{ index: 1, agent: "coder", model: "cpamc/deepseek-flash", thinking: "max", exitCode: 0 },
	] } }, NOW + 100);
	assert.equal(store.size(), 3);
	assert.equal(store.list().find((row) => row.name === "reviewer").parentId, store.list().find((row) => row.name === "scout").id);
	assert.equal(store.list().find((row) => row.name === "scout").effort, "low");
	store.update("s", { details: { runId: "r", results: [{ index: 0, agent: "scout", exitCode: 0 }, { index: 1, agent: "coder", exitCode: 0 }] } }, NOW + 200, true);
	store.settle(NOW + 250);
	assert.equal(store.running(), false);
	assert.equal(store.phase(NOW + 9999), store.phase(NOW + 250));
	store.begin(NOW + 500);
	assert.equal(store.size(), 0);
	store.start({ toolCallId: "async", toolName: "subagent", args: { agent: "scout", model: "cpamc/minimax-m3:high", async: true } }, NOW);
	const statusDir = fs.mkdtempSync(path.join(agentDir, "run-"));
	store.asyncStarted({ id: "ar", agent: "scout", asyncDir: statusDir }, NOW);
	store.update("async", { details: { runId: "ar", asyncId: "ar", asyncDir: statusDir, results: [] } }, NOW + 50, true);
	assert.equal(store.size(), 1, "native start and async receipt deduplicate the same child");
	store.settle(NOW + 100);
	assert.equal(store.running(), true, "background child keeps the rainbow active after main settles");
	assert.equal(store.mainStatus(), "done");
	fs.writeFileSync(path.join(statusDir, "status.json"), JSON.stringify({ runId: "ar", state: "running", steps: [{ agent: "scout", status: "running", model: "cpamc/minimax-m3", thinking: "medium" }] }));
	assert.equal(await store.refresh(), true);
	assert.equal(store.list()[0].effort, "medium");
	store.begin(NOW + 200);
	assert.equal(store.size(), 1, "new prompts retain background children");
	store.settle(NOW + 300, true);
	fs.writeFileSync(path.join(statusDir, "status.json"), JSON.stringify({ runId: "ar", state: "complete", steps: [{ agent: "scout", status: "complete", model: "cpamc/minimax-m3", thinking: "medium" }] }));
	await store.refresh();
	assert.equal(store.running(), false);
	assert.equal(store.list()[0].status, "done");
	store.asyncComplete({ runId: "ar", success: true }, NOW + 400);
	assert.equal(store.running(), false);
	store.clear();
	store.start({ toolCallId: "cancel", toolName: "subagent", args: { agent: "coder" } }, NOW);
	store.settle(NOW + 100, true);
	assert.equal(store.list()[0].status, "stopped");
	assert.equal(store.mainStatus(), "stopped");
	assert.equal(store.running(), false);
	store.clear();
	store.start({ toolCallId: "detached", toolName: "subagent", args: { agent: "coder" } }, NOW);
	store.update("detached", { details: { runId: "detach-run", results: [{ index: 0, agent: "coder", exitCode: 0, detached: true }] } }, NOW + 100, true);
	store.settle(NOW + 150);
	assert.equal(store.list()[0].status, "running", "detached receipt is not a completed child");
	assert.equal(store.running(), true);
	store.foregroundComplete({ runId: "detach-run", agent: "coder", taskIndex: 0, success: true }, NOW + 200);
	assert.equal(store.list()[0].status, "done");
	assert.equal(store.running(), false);
	console.log("Store: real child snapshots, nested parents, async receipt deduplication/status polling, cancellation and freeze passed");

	// Drive the actual extension handlers with fake host components and timers, without launching agents.
	const originalInterval = globalThis.setInterval;
	const originalClear = globalThis.clearInterval;
	const originalNow = Date.now;
	const timers = new Map();
	let now = NOW;
	Date.now = () => now;
	globalThis.setInterval = (fn, ms) => { const id = { unref() {} }; timers.set(id, { fn, ms }); return id; };
	globalThis.clearInterval = (id) => timers.delete(id);
	const handlers = new Map();
	const events = new Map();
	const commands = new Map();
	let widget;
	let mounts = 0;
	let redraws = 0;
	const host = {
		on(name, fn) { handlers.set(name, fn); },
		events: { on(name, fn) { events.set(name, fn); return () => events.delete(name); } },
		registerCommand(name, command) { commands.set(name, command); },
		exec: async () => ({ code: 1, stdout: "", stderr: "" }), getThinkingLevel: () => "xhigh",
	};
	const live = {
		mode: "tui", model, thinkingLevel: "xhigh",
		sessionManager: { getCwd: () => "/tmp", getSessionId: () => "test", getEntries: () => [], getSessionName: () => undefined },
		ui: {
			theme, setHiddenThinkingLabel() {}, setFooter() {}, setEditorComponent() {}, notify() {},
			setWidget(_key, factory) { widget?.dispose?.(); widget = factory?.({ ...tui, requestRender() { redraws++; } }, theme); if (factory) mounts++; },
		},
	};
	const emit = async (name, event = {}) => handlers.get(name)?.(event, live);
	const tick = () => { for (const { fn } of timers.values()) fn(); };
	try {
		extension(host);
		await emit("session_start");
		assert.ok(text(widget.render(100)).includes("main  GPT 6.1 SOL · XHIGH"));
		assert.equal(widget.render(100).length, 3);
		const before = redraws;
		tick();
		assert.equal(redraws, before);
		await emit("agent_start");
		const moving = widget.render(100)[0];
		now += ap.AGENT_PANEL_FRAME_MS;
		tick();
		assert.notEqual(widget.render(100)[0], moving);
		await emit("tool_execution_start", { toolCallId: "bash", toolName: "bash", args: { command: "echo test" } });
		await emit("tool_execution_end", { toolCallId: "bash", toolName: "bash", result: {}, isError: false });
		assert.equal(widget.render(100).length, 3, "ordinary tools don't add roster rows");
		await emit("tool_execution_start", { toolCallId: "child", toolName: "subagent", args: { agent: "scout" } });
		await emit("tool_execution_update", { toolCallId: "child", toolName: "subagent", partialResult: { details: { runId: "child-run", results: [{ index: 0, agent: "scout", model: "cpamc/minimax-m3", thinking: "high", exitCode: -1 }] } } });
		assert.ok(text(widget.render(100)).includes("scout  MINIMAX M3 · HIGH"));
		await emit("turn_end");
		await emit("agent_end");
		await emit("agent_start");
		assert.ok(text(widget.render(100)).includes("scout"));
		await emit("tool_execution_end", { toolCallId: "child", toolName: "subagent", isError: false, result: { details: { runId: "child-run", results: [{ index: 0, agent: "scout", exitCode: 0 }] } } });
		await emit("agent_settled", { aborted: false });
		const frozen = widget.render(100);
		const stoppedRedraws = redraws;
		now += 12345; tick();
		assert.equal(redraws, stoppedRedraws);
		assert.deepEqual(widget.render(100), frozen);
		assert.equal(mounts, 1);
		live.model = { id: "kimi-k3", name: "Kimi K3", reasoning: true }; live.thinkingLevel = "max";
		await emit("model_select"); await emit("thinking_level_select");
		assert.ok(text(widget.render(100)).includes("main  KIMI K3 · MAX"));
		events.get("subagent:async-started")({ id: "other", agent: "not-mine", sessionId: "another-parent" });
		events.get("subagent:child-status")({ runId: "unknown-parent", agent: "not-mine", childId: "x", status: "started" });
		assert.ok(!text(widget.render(100)).includes("not-mine"));
		events.get("subagent:async-started")({ id: "own-bg", agents: ["inspector"], sessionId: "test" });
		assert.ok(text(widget.render(100)).includes("inspector"));
		events.get("subagent:async-complete")({ runId: "own-bg", success: true });
		assert.ok(text(widget.render(100)).includes("✓ inspector"));
		await commands.get("warm-ui").handler("agent-panel off", live); assert.equal(widget, undefined);
		await commands.get("warm-ui").handler("agent-panel on", live); assert.ok(widget);
		await commands.get("warm-ui").handler("off", live); assert.equal(widget, undefined);
		await commands.get("warm-ui").handler("on", live); assert.ok(widget);
		await emit("session_shutdown"); widget?.dispose?.(); widget = undefined;
		assert.equal(timers.size, 0); assert.equal(events.size, 0);
		await emit("session_start"); assert.ok(widget);
		await emit("session_shutdown"); widget?.dispose?.();
		assert.equal(timers.size, 0); assert.equal(events.size, 0);
		console.log("Lifecycle: main/default model, live model/effort changes, child-only rows, toggles, settled freeze and cleanup passed");
	} finally { globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear; Date.now = originalNow; }
} finally { fs.rmSync(agentDir, { recursive: true, force: true }); }
