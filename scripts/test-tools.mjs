#!/usr/bin/env node
// Run from repo root: node scripts/test-tools.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PI_PKG, loadTs } from "./lib/pi-resolve.mjs";
import { loadTheme, THEMES, stripTerminalSequences, visibleWidth } from "./lib/fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createToolResolver } = await loadTs(path.join(repo, "extensions/warm-ui/tools.ts"));
const { codemodeRenderers } = await import(pathToFileURL(path.join(PI_PKG, "dist/extensions/codemode/renderer.js")));
const { setThemeInstance } = await import(pathToFileURL(path.join(PI_PKG, "dist/modes/interactive/theme/theme.js")));
const { ToolExecutionComponent } = await import(pathToFileURL(path.join(PI_PKG, "dist/modes/interactive/components/tool-execution.js")));
const { Text } = await import(pathToFileURL(path.join(PI_PKG, "node_modules/@earendil-works/pi-tui/dist/index.js")));
const code = `const secretScriptMarker = ${JSON.stringify("脚本🚀".repeat(400))};\ntext(secretScriptMarker);`;
const output = `outputMarker ${"JSON输出🚀".repeat(2000)}\nlastOutputMarker`;
const result = {
	content: [
		{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
		{ type: "text", text: output },
	],
	details: {
		calls: Array.from({ length: 12 }, (_, i) => ({
			name: `nestedTool${i}`, args: "nestedArgsMarker", status: "ok", durationMs: 10,
		})),
		fullOutputPath: "/tmp/fullOutputMarker.txt",
	},
};

function context(expanded = false, isPartial = false, isError = false) {
	return {
		args: { code }, toolCallId: "test", invalidate() {}, state: {}, cwd: repo,
		executionStarted: true, argsComplete: true, isPartial, expanded, showImages: false,
		isError, durationMs: 100, outputPad: 0,
	};
}

function plain(component, width = 80) {
	return component.render(width).map(stripTerminalSequences);
}

for (const themeName of THEMES) {
	const theme = loadTheme(repo, themeName);
	setThemeInstance(theme);
	let callRenders = 0;
	let resultRenders = 0;
	const base = {
		...codemodeRenderers,
		renderCall(...args) { callRenders++; return codemodeRenderers.renderCall(...args); },
		renderResult(...args) { resultRenders++; return codemodeRenderers.renderResult(...args); },
	};
	const renderer = createToolResolver(() => true)("codemode", () => base);
	const ctx = context();
	let call = renderer.renderCall(ctx.args, theme, ctx);
	assert.equal(callRenders, 0, "collapsed scripts skip the expensive base highlighter");
	assert.match(plain(call).join("\n"), /codemode.*2 lines of JavaScript/);
	assert.doesNotMatch(plain(call).join("\n"), /secretScriptMarker/);
	let body = renderer.renderResult(result, { expanded: false, isPartial: false }, theme, ctx);
	assert.equal(resultRenders, 0, "collapsed results never build the expanded base body");
	assert.match(plain(body).join("\n"), /done.*12 calls.*to expand/);
	assert.doesNotMatch(plain(body).join("\n"), /outputMarker|nestedTool|fullOutputMarker/);
	for (const width of [4, 8, 12, 24, 40, 80, 120, 200]) {
		const lines = plain(body, width);
		assert.equal(lines.length, 1, "even a huge single JSON line occupies only one result row");
		for (const line of [...lines, ...plain(call, width)]) {
			assert.ok(visibleWidth(line) <= width, `${themeName}: width overflow at ${width}`);
		}
	}

	// Expand -> fold -> expand with the same shared state and returned wrapper components.
	ctx.expanded = true;
	ctx.lastComponent = call;
	call = renderer.renderCall(ctx.args, theme, ctx);
	assert.match(plain(call).join("\n"), /secretScriptMarker/);
	ctx.lastComponent = body;
	body = renderer.renderResult(result, { expanded: true, isPartial: false }, theme, ctx);
	assert.match(plain(body).join("\n"), /outputMarker/);
	assert.match(plain(body).join("\n"), /lastOutputMarker/);
	assert.match(plain(body).join("\n"), /nestedTool0/);
	assert.match(plain(body).join("\n"), /nestedTool11/);
	const originalContent = JSON.stringify(result);
	for (const expanded of [false, true, false]) {
		ctx.expanded = expanded;
		ctx.lastComponent = call;
		call = renderer.renderCall(ctx.args, theme, ctx);
		ctx.lastComponent = body;
		body = renderer.renderResult(result, { expanded, isPartial: false }, theme, ctx);
		assert.equal(plain(call).join("\n").includes("secretScriptMarker"), expanded);
		assert.equal(plain(body).join("\n").includes("lastOutputMarker"), expanded);
	}
	assert.equal(JSON.stringify(result), originalContent, "rendering must not change model-facing results");

	// Streaming, rejected input, caught nested failures, cancellation, and old results without details.
	const scenarios = [
		{ partial: true, calls: [{ status: "running" }], match: /running.*1 call.*1 running/ },
		{ error: true, calls: [{ status: "error" }], match: /failed.*1 call.*1 failed/ },
		{ calls: [{ status: "error" }], match: /done.*1 call.*1 failed/ },
		{ calls: [{ status: "cancelled" }], match: /done.*1 call.*1 cancelled/ },
		{ error: true, match: /failed.*to expand/ },
		{ match: /done.*to expand/ },
	];
	for (const scenario of scenarios) {
		const ctx = context(false, !!scenario.partial, !!scenario.error);
		const r = { content: [{ type: "text", text: "no header" }], details: scenario.calls ? { calls: scenario.calls } : undefined };
		const component = renderer.renderResult(r, { expanded: false, isPartial: ctx.isPartial }, theme, ctx);
		assert.match(plain(component).join("\n"), scenario.match);
		assert.equal(plain(component).length, 1);
	}

	// Exercise Pi's actual component lifecycle, including a live expanded timer folded before completion.
	const tool = new ToolExecutionComponent("codemode", "lifecycle", { code }, { showImages: false }, renderer, { requestRender() {} }, repo);
	try {
		tool.setArgsComplete();
		tool.markExecutionStarted();
		tool.updateResult(result, true);
		tool.setExpanded(true);
		assert.ok(tool.rendererState.interval, "the original streaming renderer started its timer");
		tool.setExpanded(false);
		tool.updateResult({ ...result, isError: false, durationMs: 100 });
		assert.equal(tool.rendererState.interval, undefined, "folded final results stop the original timer");
		assert.equal(tool.rendererState.wuTimer, undefined, "folded final results stop the wrapper timer");
		assert.equal(plain(tool).filter((line) => line.trim()).length, 2, "completed call is just a header and summary");
		tool.setExpanded(true);
		assert.match(plain(tool).join("\n"), /secretScriptMarker/);
		assert.match(plain(tool).join("\n"), /lastOutputMarker/);
		tool.setExpanded(false);
		assert.doesNotMatch(plain(tool).join("\n"), /secretScriptMarker|lastOutputMarker|nestedTool/);
	} finally {
		clearInterval(tool.rendererState.interval);
		clearInterval(tool.rendererState.wuTimer);
	}

	// Generic tools still delegate to their original result renderer, and disabling is transparent.
	assert.equal(createToolResolver(() => false)("codemode", () => base), base);
	const other = createToolResolver(() => true)("custom", () => ({ renderResult: () => new Text("original result", 0, 0) }));
	assert.match(plain(other.renderResult(result, { expanded: false, isPartial: false }, theme, context())).join("\n"), /original result/);
}
console.log(`Tool renderer tests passed (${THEMES.length} themes; 8 widths; expand/fold, streaming, errors and timer cleanup).`);
