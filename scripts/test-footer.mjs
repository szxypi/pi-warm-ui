#!/usr/bin/env node
// Run from repo root: node scripts/test-footer.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { visibleWidth, stripTerminalSequences, THEMES, ICONS, MODES, SCENARIOS, makeFooter } =
	await import(path.join(__dirname, "lib/fixtures.mjs"));

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../");
const EXT_DIR = path.join(REPO, "extensions");

// Full 0-200 range plus sub-zero edge cases
const WIDTHS = [
	-2, -1, 0,
	...Array.from({ length: 201 }, (_, i) => i),
];

let pass = 0;
let fail = 0;
const failures = [];
const samples = {};

function assert(label, cond, detail = "") {
	if (cond) {
		pass++;
	} else {
		fail++;
		failures.push(`FAIL: ${label}${detail ? " — " + detail : ""}`);
	}
}

/** Expected pctText for a given scenario, matching footer.ts logic. */
function expectedPctText(scenario) {
	const pct = scenario.contextPct ?? null;
	if (pct === null) return "?%";
	if (pct < 10) return `${pct.toFixed(1)}%`;
	return `${Math.round(pct)}%`;
}

/** Strip ANSI SGR sequences. */
function stripAnsi(s) {
	return typeof stripTerminalSequences === "function"
		? stripTerminalSequences(s)
		: s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Return true if line contains a truecolor bg SGR: ESC[48;2;R;G;Bm */
function hasTruecolorBg(line) {
	return /\x1b\[(?:[0-9;]*;)?48;2;\d+;\d+;\d+m/.test(line);
}

for (const themeName of THEMES) {
	for (const icons of ICONS) {
		for (const mode of MODES) {
			// FIX: pass the string "band"/"plain", not a boolean.
			// footer.ts checks: config.statusBar === "band"
			const statusBar = mode; // "band" or "plain"

			for (const [scenarioName, scenario] of Object.entries(SCENARIOS)) {
				// Build footer ONCE per theme/icons/mode/scenario — outside the width loop.
				let footer;
				const outerLabel = `${themeName}|${icons}|${mode}|${scenarioName}`;
				try {
					footer = await makeFooter({
						extDir: EXT_DIR,
						repo: REPO,
						themeName,
						icons,
						statusBar,
						scenario,
					});
				} catch (e) {
					fail++;
					failures.push(`FAIL: ${outerLabel} — makeFooter threw: ${e.message}`);
					continue;
				}

				const hasWindow =
					scenario.contextWindow !== undefined && scenario.contextPct !== undefined;
				const pctText = hasWindow ? expectedPctText(scenario) : null;

				for (const width of WIDTHS) {
					const label = `${outerLabel}|w${width}`;

					let rendered;
					try {
						rendered = footer.render(width);
					} catch (e) {
						fail++;
						failures.push(`FAIL: ${label} — render threw: ${e.message}`);
						continue;
					}

					const lines = Array.isArray(rendered) ? rendered : [rendered];

					// Save samples: normal-session × 2 themes × all 4 styles × nerd icons × 3 widths
					const isTargetSample =
						scenarioName === "normal-session" &&
						["eyecare-warm", "eyecare-warm-light"].includes(themeName) &&
						icons === "nerd" &&
						[40, 80, 120].includes(width);
					if (isTargetSample) {
						samples[label] = lines;
					}

					const maxVisual = Math.max(0, width);

					for (let li = 0; li < lines.length; li++) {
						const line = lines[li];

						// A1: each line must be a string
						assert(`line is string [${label}:line${li}]`, typeof line === "string",
							`got ${typeof line}`);
						if (typeof line !== "string") continue;

						const vw = visibleWidth(line);
						const lineLabel = `${label}:line${li}`;

						// A2: visible width must not exceed max(0, width)
						assert(
							`visibleWidth <= max(0,width) [${lineLabel}]`,
							vw <= maxVisual,
							`visibleWidth=${vw} > maxVisual=${maxVisual}`
						);
					}

					if (lines.length === 0) continue;

					// A0: positive width must have lines[0] === "" (blank gap line before capsule)
					if (width > 0) {
						assert(
							`lines[0] is blank gap [${label}]`,
							lines[0] === "",
							`expected "" but got ${JSON.stringify(lines[0])}`
						);
						// A0b: positive width must produce exactly 2 lines (gap + capsule) for normal scenarios
						assert(
							`positive width has exactly 2 lines [${label}]`,
							lines.length === 2 + (scenarioName === "status-line" ? 1 : 0),
							`expected ${2 + (scenarioName === "status-line" ? 1 : 0)} lines but got ${lines.length}`
						);
					} else {
						// A0d: non-positive width must produce exactly [""] (strict, no empty-filter escape)
						assert(
							`non-positive width produces exactly [""] [${label}]`,
							lines.length === 1 && lines[0] === "",
							`expected [""] but got ${JSON.stringify(lines)}`
						);
					}

					// Capsule is now at lines[1] (lines[0] is the blank gap line)
					const capsuleLine = typeof lines[1] === "string" ? lines[1] : "";
					const plainCapsule = stripAnsi(capsuleLine);

					// A3: context pctText — only when window present and width wide enough to show it
					if (pctText !== null && width >= 8) {
						assert(
							`context pctText present [${label}]`,
							plainCapsule.includes(pctText),
							`expected "${pctText}" in: ${JSON.stringify(plainCapsule.slice(0, 120))}`
						);
					}

					// A4: "hidden one" status must NOT appear in any line (it is in hideStatuses)
					if (scenarioName === "status-line") {
						const allPlain = lines.map(stripAnsi).join("\n");
						assert(
							`hideStatuses "hidden one" absent [${label}]`,
							!allPlain.includes("hidden one"),
							`found "hidden one" in output`
						);
						// "goal" and "plan" statuses should appear (not hidden), now at lines[2]
						if (width >= 8 && lines.length >= 3) {
							const statusLine = stripAnsi(lines[2]);
							assert(
								`visible statuses present [${label}:line2]`,
								statusLine.includes("goal") || statusLine.includes("plan"),
								`expected "goal" or "plan" in: ${JSON.stringify(statusLine.slice(0, 120))}`
							);
						}
					}

					// A5: capsule line width (lines[1])
					if (lines.length >= 2 && typeof lines[1] === "string") {
						const vw1 = visibleWidth(lines[1]);
						assert(
							`line1 visibleWidth <= max(0,width) [${label}:line1]`,
							vw1 <= maxVisual,
							`visibleWidth=${vw1} > maxVisual=${maxVisual}`
						);
					}

					// A5b: status line width (lines[2], when present)
					if (lines.length >= 3 && typeof lines[2] === "string") {
						const vw2 = visibleWidth(lines[2]);
						assert(
							`line2 visibleWidth <= max(0,width) [${label}:line2]`,
							vw2 <= maxVisual,
							`visibleWidth=${vw2} > maxVisual=${maxVisual}`
						);
					}

					// A6: project name shown as basename or home~
					if (width >= 24) {
						const cwd = scenario.cwd ?? "/home/user/projects/acme-api";
						const home = os.homedir();
						const base = path.basename(cwd);
						const isHome = cwd === home;
						if (!isHome && base) {
							// The footer clips long names; for CJK (2-col chars) use 4 chars, else 8.
							const isCjkHeavy = /[一-鿿　-〿]/.test(base);
							const checkLen = Math.min(base.length, isCjkHeavy ? 4 : 8);
							const basePrefix = base.slice(0, checkLen);
							assert(
								`project basename present [${label}]`,
								plainCapsule.includes(basePrefix) || plainCapsule.includes("~"),
								`expected "${basePrefix}" or "~" in: ${JSON.stringify(plainCapsule.slice(0, 120))}`
							);
						}
					}

					// A7 (anti-vacuous): band mode with width>=80 must produce truecolor bg SGR on capsule line
					if (mode === "band" && width >= 80) {
						assert(
							`band mode has truecolor bg SGR [${label}]`,
							hasTruecolorBg(capsuleLine),
							`no 48;2;R;G;B found in capsule line (lines[1])`
						);
					}

					// A8: plain mode must NOT produce truecolor bg SGR on capsule line
					if (mode === "plain") {
						assert(
							`plain mode has no bg SGR [${label}]`,
							!hasTruecolorBg(capsuleLine),
							`unexpected 48;2;R;G;B in plain capsule line (lines[1])`
						);
					}

					// A9: nerd icons — capLeft U+E0B6 or capRight U+E0B4 present in band mode at width>=80
					if (mode === "band" && icons === "nerd" && width >= 80) {
						assert(
							`nerd band has cap glyphs U+E0B6/U+E0B4 [${label}]`,
							capsuleLine.includes("") || capsuleLine.includes(""),
							`neither U+E0B6 nor U+E0B4 found in capsule line (lines[1])`
						);
					}

					// A11: bar mode must NOT produce cap glyphs
					if (mode === "bar" && width >= 80) {
						assert(
							`bar mode has no cap glyphs [${label}]`,
							!capsuleLine.includes("") && !capsuleLine.includes(""),
							`cap glyph found in bar capsule line (lines[1])`
						);
					}

					// A12: rail mode must NOT produce truecolor bg SGR on capsule line
					if (mode === "rail") {
						assert(
							`rail mode has no bg SGR [${label}]`,
							!hasTruecolorBg(capsuleLine),
							`unexpected 48;2;R;G;B in rail capsule line (lines[1])`
						);
					}

					// A13: rail mode must NOT produce cap glyphs
					if (mode === "rail" && width >= 80) {
						assert(
							`rail mode has no cap glyphs [${label}]`,
							!capsuleLine.includes("") && !capsuleLine.includes(""),
							`cap glyph found in rail capsule line (lines[1])`
						);
					}
				}
			}
		}
	}
}

// ── panel style ──
// The panel is three rows that fill the width. Below PANEL_MIN_WIDTH it falls back to plain text.
const PANEL_MIN_WIDTH = 20;
const PANEL_WIDTHS = [200, 120, 100, 80, 60, 40, 30, 24, 20];

{
	const { loadTs } = await import(path.join(__dirname, "lib/pi-resolve.mjs"));
	const { loadTheme, BASE, makeFooter: makePanelFooter } = await import(path.join(__dirname, "lib/fixtures.mjs"));
	const mod = await loadTs(path.join(EXT_DIR, "warm-ui/footer.ts"));
	const panelSamples = {};

	// A footer with an explicit panel config, for the theme-swap and level checks.
	const buildPanel = async (themeName, icons, scenario, statusBar = "panel") =>
		makePanelFooter({ extDir: EXT_DIR, repo: REPO, themeName, icons, statusBar, scenario });

	for (const themeName of THEMES) {
		for (const icons of ICONS) {
			for (const [scenarioName, scenario] of Object.entries(SCENARIOS)) {
				const label = `${themeName}|${icons}|panel|${scenarioName}`;
				let footer;
				try {
					footer = await buildPanel(themeName, icons, scenario);
				} catch (e) {
					fail++;
					failures.push(`FAIL: ${label} — makeFooter threw: ${e.message}`);
					continue;
				}
				for (const width of PANEL_WIDTHS) {
					let lines;
					try {
						lines = footer.render(width);
					} catch (e) {
						fail++;
						failures.push(`FAIL: ${label}|w${width} — render threw: ${e.message}`);
						continue;
					}
					const at = `${label}|w${width}`;
					// P1: the panel is three rows, plus the extension status line when a status exists.
					// Every row fills the terminal width exactly. At a width where the model segment does not
					// fit, the panel gives up and plain text draws instead; the plain line still fills the width.
					const wantLines = 3 + (Object.keys(scenario.statuses ?? {}).length ? 1 : 0);
					if (lines.length !== wantLines) {
						assert(`narrow panel falls back to plain text [${at}]`, !stripAnsi(lines.join("")).includes("╭"),
							`got ${lines.length} rows that are not a plain fallback`);
						for (let li = 1; li < lines.length; li++) {
							assert(`fallback row ${li} fills the width [${at}]`, visibleWidth(lines[li]) <= width,
								`visibleWidth=${visibleWidth(lines[li])} > ${width}`);
						}
						continue;
					}
					for (let i = 0; i < 3; i++) {
						const vw = visibleWidth(lines[i]);
						assert(`panel row ${i} fills the width [${at}]`, vw === width, `visibleWidth=${vw} != ${width}`);
					}
					const plain = lines.map(stripAnsi);
					// P2: the corners sit on the first and the last column.
					assert(`panel top-left corner [${at}]`, plain[0].startsWith("╭"), JSON.stringify(plain[0].slice(0, 4)));
					assert(`panel top-right corner [${at}]`, plain[0].endsWith("╮"), JSON.stringify(plain[0].slice(-4)));
					assert(`panel middle sides [${at}]`, plain[1].startsWith("│") && plain[1].endsWith("│"));
					assert(`panel bottom-left corner [${at}]`, plain[2].startsWith("╰"), JSON.stringify(plain[2].slice(0, 4)));
					assert(`panel bottom-right corner [${at}]`, plain[2].endsWith("╯"), JSON.stringify(plain[2].slice(-4)));
					// P3: the context percentage is the last part to go.
					if (scenario.contextWindow !== undefined) {
						assert(`panel keeps the context percentage [${at}]`, plain[1].includes(expectedPctText(scenario)),
							`expected "${expectedPctText(scenario)}" in: ${JSON.stringify(plain[1])}`);
					}
					// P4: a band never shows a background fill in the panel.
					assert(`panel has no bg SGR [${at}]`, !lines.some(hasTruecolorBg), "unexpected 48;2;R;G;B");
					if (scenarioName === "normal-session" && themeName === "eyecare-warm" && icons === "nerd" && [120, 100, 60].includes(width)) {
						panelSamples[`${themeName}|${icons}|panel|${scenarioName}|w${width}`] = lines;
					}
				}
			}
		}
	}

	// P5: the drop order. A wide line keeps the session name and the counts; a narrow one keeps neither,
	// but the directory and the context usage stay. A branch goes before the project name.
	{
		const wide = stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS["normal-session"])).render(200).join("\n"));
		const mid = stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS["normal-session"])).render(60).join("\n"));
		const narrow = stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS["normal-session"])).render(30).join("\n"));
		assert("panel wide shows the session name", wide.includes("rate limit fix"));
		assert("panel wide shows the git counts", wide.includes("+1") && wide.includes("~1") && wide.includes("?1"));
		assert("panel narrow drops the session name", !narrow.includes("rate limit fix"));
		assert("panel narrow drops the git counts", !narrow.includes("+1"));
		assert("panel narrow keeps the directory", narrow.includes("acme-api"));
		assert("panel narrow keeps the context percentage", narrow.includes("62%"));
		// The branch outlives the counts but goes before the directory is shortened.
		assert("panel mid keeps the branch", mid.includes("feat/rate-limit"));
		assert("panel mid drops the git counts", !mid.includes("+1"));
	}

	// P6: the border follows the six context levels.
	{
		const levels = [
			[10, "success"],
			[31, "yellow"],
			[51, "warning"],
			[71, "clay"],
			[86, "error"],
			[96, "darkred"],
		];
		const seen = [];
		for (const [pct] of levels) {
			const f = await buildPanel("eyecare-warm", "nerd", { ...BASE, contextPct: pct });
			const line = f.render(100)[0];
			const rgb = (line.match(/\x1b\[[0-9;]*38;2;(\d+;\d+;\d+)m/) || [])[1];
			seen.push(rgb);
		}
		assert("panel border has six distinct level colors", new Set(seen).size === levels.length, `got ${JSON.stringify(seen)}`);
		assert("panel border ends dark red above 95%", seen[5] === "208;48;48", `got ${seen[5]}`);
		assert("panel border is clay between 70% and 85%", seen[3] === "224;90;70", `got ${seen[3]}`);
	}

	// P7: without a context window the panel still fills the width and draws the usage totals.
	{
		const f = await buildPanel("eyecare-warm", "nerd", SCENARIOS.nocontext);
		const lines = f.render(100);
		assert("panel without context has three rows", lines.length === 3);
		assert("panel without context fills the width", lines.every((l) => visibleWidth(l) === 100));
		assert("panel without context shows the tokens", stripAnsi(lines[1]).includes("617k"));
		assert("panel without context has no ctx label", !stripAnsi(lines[1]).includes("ctx"));
	}

	// P8: below PANEL_MIN_WIDTH the footer is plain text, not a box.
	{
		const f = await buildPanel("eyecare-warm", "nerd", SCENARIOS["normal-session"]);
		for (const width of [1, 8, 12, 19]) {
			const lines = f.render(width);
			assert(`panel falls back below ${PANEL_MIN_WIDTH} [w${width}]`, !stripAnsi(lines.join("")).includes("╭"));
		}
	}

	// P9: the nerd icon set draws the icons; the none set draws no Nerd Font glyph.
	{
		const nerd = stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS["normal-session"])).render(120).join("\n"));
		const none = stripAnsi((await buildPanel("eyecare-warm", "none", SCENARIOS["normal-session"])).render(120).join("\n"));
		assert("panel nerd draws the dir icon U+F07C", nerd.includes(""));
		assert("panel none draws no dir icon", !none.includes(""));
		assert("panel none keeps the labels", none.includes("ctx") && none.includes("cache"));
	}

	// P10: the model and the thinking level sit right after "╭─", before the directory.
	{
		for (const width of [200, 100, 60]) {
			const top = stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS["normal-session"])).render(width)[0]);
			const at = `[w${width}]`;
			assert(`panel top starts with the model ${at}`, /^╭─\s*[^\s]*\s*glm-5\.3/.test(top), JSON.stringify(top.slice(0, 30)));
			assert(`panel model is followed by the level ${at}`, top.includes("glm-5.3 · max"), JSON.stringify(top.slice(0, 40)));
			// The model comes before the directory.
			assert(`panel model precedes the directory ${at}`, top.indexOf("glm-5.3") < top.indexOf("acme-api"));
		}
	}

	// P11: a reasoning model with thinking off, or a model that does not think, shows the name only.
	{
		for (const name of ["no-thinking", "thinking-off"]) {
			const top = stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS[name])).render(120)[0]);
			assert(`panel ${name} shows the model`, top.includes("glm-5.3"), JSON.stringify(top.slice(0, 40)));
			assert(`panel ${name} shows no level`, !top.includes("max"), JSON.stringify(top.slice(0, 40)));
			assert(`panel ${name} draws no bare dot`, !top.includes(" · "), JSON.stringify(top.slice(0, 40)));
			assert(`panel ${name} still shows the directory`, top.includes("acme-api"));
		}
	}

	// P12: the thinking level keeps the editor's ramp. max is the warm orange, and the six levels differ.
	{
		const seen = [];
		for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
			const line = (await buildPanel("eyecare-warm", "nerd", { ...BASE, thinkingLevel: level }, "panel")).render(120)[0];
			// The run right before the level text carries its color.
			const m = [...line.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m([^\x1b]*)/g)].find((x) => x[2].trim() === level);
			seen.push(m?.[1]);
		}
		assert("panel draws every thinking level", seen.every(Boolean), `got ${JSON.stringify(seen)}`);
		assert("panel thinking levels use six colors", new Set(seen).size === 6, `got ${JSON.stringify(seen)}`);
		assert("panel max is the theme thinkingMax orange", seen[5] === "233;162;95", `got ${seen[5]}`);
	}

	// P13: the drop order. The session name goes first, then the counts, then the branch. The model and the
	// level outlive all of them; the level goes last, and only after the model name is clipped.
	{
		const at = async (width) => stripAnsi((await buildPanel("eyecare-warm", "nerd", SCENARIOS["long-model"])).render(width)[0]);
		const wide = await at(200);
		const mid = await at(100);
		const narrow = await at(60);
		const tiny = await at(35);
		const full = "claude-opus-5-5-xhigh-super-long-variant-name";
		assert("model keeps the session name at 200", wide.includes("a long session name"));
		assert("model keeps the git counts at 200", wide.includes("+1") && wide.includes("~1") && wide.includes("?1"));
		assert("model drops the session name at 100", !mid.includes("a long session name"));
		assert("model drops the git counts at 100", !mid.includes("+1") && !mid.includes("?1"));
		assert("model still shows the level at 100", mid.includes("· max"));
		assert("model keeps the branch at 100", mid.includes("feat/rate-limit"));
		assert("model drops the branch at 60", !narrow.includes("feat/rate-limit"));
		assert("model keeps the directory at 60", narrow.includes("acme-api"));
		assert("model keeps the level at 60", narrow.includes("· max"));
		// The name is shortened only after the branch is gone.
		assert("model is whole at 100", mid.includes(full));
		assert("model is clipped at 60", narrow.includes("…") && !narrow.includes(full));
		// The level is the last to go: it survives while the branch is gone.
		assert("model keeps the level at 35", tiny.includes("· max"));
		assert("model keeps the level after the branch is gone", tiny.includes("· max") && !tiny.includes("feat/rate-limit"));
		assert("model name is never silently dropped while the box draws", tiny.includes("claude-o"));
	}

	// P14: every icon set draws the model segment, and only nerd draws the model glyph.
	{
		for (const icons of ICONS) {
			const top = stripAnsi((await buildPanel("eyecare-warm", icons, SCENARIOS["normal-session"])).render(120)[0]);
			assert(`panel ${icons} shows the model`, top.includes("glm-5.3"), JSON.stringify(top.slice(0, 40)));
			assert(`panel ${icons} shows the level`, top.includes("· max"), JSON.stringify(top.slice(0, 40)));
			assert(`panel ${icons} keeps the width`, (await buildPanel("eyecare-warm", icons, SCENARIOS["normal-session"])).render(120).every((l) => visibleWidth(l) === 120));
			if (icons === "nerd") assert("panel nerd draws the model icon", top.includes("\u{F06A9}"), JSON.stringify(top.slice(0, 20)));
			else assert(`panel ${icons} draws no Nerd model glyph`, !top.includes("\u{F06A9}"), JSON.stringify(top.slice(0, 20)));
		}
	}

	const panelPath = process.env.PANEL_SAMPLES ?? path.join(os.tmpdir(), "warm-panel-samples.json");
	fs.writeFileSync(panelPath, JSON.stringify(panelSamples, null, 2));
	console.log(`\nPanel samples written to ${panelPath} (${Object.keys(panelSamples).length} entries)`);
}

// ── agent panel ──
// The persistent box above the input lists the latest run's tool calls. Pure rendering, so the tests
// build the input directly and never touch an extension context.
{
	const { loadTs } = await import(path.join(__dirname, "lib/pi-resolve.mjs"));
	const { loadTheme, BASE } = await import(path.join(__dirname, "lib/fixtures.mjs"));
	const ap = await loadTs(path.join(EXT_DIR, "warm-ui/agent-panel.ts"));
	const { icons } = await loadTs(path.join(EXT_DIR, "warm-ui/icons.ts"));

	const NOW = 1_700_000_000_000;
	const call = (id, name, status, extra = {}) => ({
		id,
		name,
		args: name === "bash" ? { command: `cmd ${id}` } : { path: `src/${id}.js` },
		cwd: BASE.cwd,
		status,
		startedAt: NOW - 3000,
		...(status === "running" ? {} : { durationMs: 400 }),
		...extra,
	});
	const CALLS = [
		call("a", "bash", "running", { args: { command: "sleep 5" } }),
		call("b", "read", "done", { parentId: "a" }),
		call("c", "edit", "error"),
	];
	const draw = (themeName, iconSet, width, calls, collapsed = false) => {
		const theme = loadTheme(REPO, themeName);
		return ap.renderAgentPanel({
			width,
			calls,
			collapsed,
			now: NOW,
			theme,
			ic: icons(iconSet),
			showAgentIcon: iconSet !== "none",
		});
	};

	const AP_WIDTHS = [200, 100, 60, 30];
	for (const themeName of THEMES) {
		for (const iconSet of ICONS) {
			for (const width of AP_WIDTHS) {
				for (const collapsed of [false, true]) {
					const at = `${themeName}|${iconSet}|w${width}|${collapsed ? "collapsed" : "expanded"}`;
					let lines;
					try {
						lines = draw(themeName, iconSet, width, CALLS, collapsed);
					} catch (e) {
						fail++;
						failures.push(`FAIL: agent panel ${at} — render threw: ${e.message}`);
						continue;
					}
					// A1: every line is exactly the terminal width.
					for (let i = 0; i < lines.length; i++) {
						const vw = visibleWidth(lines[i]);
						assert(`agent panel row ${i} fills the width [${at}]`, vw === width, `visibleWidth=${vw} != ${width}`);
					}
					const plain = lines.map(stripAnsi);
					// A2: the frame.
					assert(`agent panel opens with ╭─ [${at}]`, plain[0].startsWith("╭─"), JSON.stringify(plain[0].slice(0, 6)));
					assert(`agent panel closes the top with ─╮ [${at}]`, plain[0].endsWith("─╮"), JSON.stringify(plain[0].slice(-6)));
					assert(`agent panel has no duplicate header [${at}]`, !/main|glm-5\.3| · max|●/.test(plain[0]), JSON.stringify(plain[0]));
					assert(`agent panel left edge is uninterrupted [${at}]`, /^╭─+ /.test(plain[0]), JSON.stringify(plain[0]));
					// A3: the fold marker matches the state.
					assert(`agent panel marker [${at}]`, plain[0].includes(collapsed ? "[+]" : "[-]"), JSON.stringify(plain[0].slice(-20)));
					if (collapsed) {
						// A4: collapsed is the top border only, with the call count.
						assert(`collapsed panel is one row [${at}]`, lines.length === 1, `got ${lines.length}`);
						assert(`collapsed panel counts the calls [${at}]`, plain[0].includes("3"), JSON.stringify(plain[0].slice(-24)));
					} else {
						// A5: expanded is the top, one row per call, and the bottom border.
						assert(`expanded panel row count [${at}]`, lines.length === CALLS.length + 2, `got ${lines.length}`);
						assert(`expanded panel closes with ╰ [${at}]`, plain[plain.length - 1].startsWith("╰"));
						assert(`expanded panel ends with ─╯ [${at}]`, plain[plain.length - 1].endsWith("─╯"));
					}
				}
			}
		}
	}

	// A6: the three status dots.
	{
		const plain = draw("eyecare-warm", "unicode", 100, CALLS).map(stripAnsi).join("\n");
		assert("agent panel marks the running call", plain.includes("● bash"));
		assert("agent panel marks the finished call", plain.includes("✓ read"));
		assert("agent panel marks the failed call", plain.includes("✗ edit"));
	}

	// A7: a child call is indented one level, and the parent is not.
	{
		const lines = draw("eyecare-warm", "unicode", 100, CALLS).map(stripAnsi);
		const parentRow = lines.find((line) => line.includes("bash")) ?? "";
		const childRow = lines.find((line) => line.includes("read")) ?? "";
		assert("agent panel does not indent the parent", !parentRow.includes("│ ✓ read") && parentRow.includes("● bash"));
		assert("agent panel indents the child", childRow.includes("│ ✓ read"), JSON.stringify(childRow));
		// The child prefix sits inside the box border, so it reads "│ │ ✓ read".
		assert("agent panel child prefix follows the border", /^│ │ ✓ read/.test(childRow), JSON.stringify(childRow));
	}

	// A8: the 6 row cap keeps the running calls and ends with "… +N more".
	{
		const many = Array.from({ length: 10 }, (_, i) => call(`c${i}`, "bash", i === 1 || i === 7 ? "running" : "done"));
		const lines = draw("eyecare-warm", "unicode", 100, many).map(stripAnsi);
		// The top, five call rows, the "more" row and the bottom border.
		assert("agent panel caps the rows at six", lines.length === ap.AGENT_PANEL_MAX_ROWS + 2, `got ${lines.length}`);
		assert("agent panel ends the list with … +N more", lines.some((line) => /… \+5 more/.test(line)), JSON.stringify(lines));
		const body = lines.slice(1, -1).join("\n");
		assert("agent panel keeps both running calls", (body.match(/● bash/g) ?? []).length === 2, JSON.stringify(body));
		// Running rows come first.
		assert("agent panel puts the running calls first", /● bash[\s\S]*● bash[\s\S]*✓ bash/.test(body), JSON.stringify(body));
	}

	// A9: a finished call keeps its final duration, a running one counts up.
	{
		const lines = draw("eyecare-warm", "unicode", 100, CALLS).map(stripAnsi);
		const done = lines.find((line) => line.includes("edit")) ?? "";
		assert("agent panel keeps the final duration", done.includes("0.4s"), JSON.stringify(done));
		const later = ap.renderAgentPanel({
			width: 100,
			calls: [call("a", "bash", "running")],
			collapsed: false,
			now: NOW + 60_000,
			theme: loadTheme(REPO, "eyecare-warm"),
			ic: icons("unicode"),
			showAgentIcon: false,
		});
		assert("agent panel counts a running call up", stripAnsi(later.join("\n")).includes("1m03s"), JSON.stringify(stripAnsi(later.join("\n"))));
	}

	// A10: the width rungs. A wide row keeps the summary, a narrow one drops it, a narrower one drops
	// the duration, and below the minimum only the top border draws.
	{
		const wide = draw("eyecare-warm", "unicode", 100, CALLS).map(stripAnsi).join("\n");
		assert("agent panel keeps the summary when wide", wide.includes("sleep 5"), JSON.stringify(wide));
		// At 30 columns the shortest summary still fits; a long one is the first thing a row gives up.
		const long = [call("a", "bash", "running", { args: { command: "a very long command line that will not fit in a narrow row" } })];
		const narrow = draw("eyecare-warm", "unicode", 30, long).map(stripAnsi).join("\n");
		assert("agent panel drops a summary that does not fit", !narrow.includes("very long command"), JSON.stringify(narrow));
		assert("agent panel keeps the tool name when the summary goes", narrow.includes("bash"), JSON.stringify(narrow));
		const tiny = draw("eyecare-warm", "unicode", 29, CALLS).map(stripAnsi);
		assert("agent panel draws the top border only below 30", tiny.length === 1 && tiny[0].startsWith("╭─"), JSON.stringify(tiny));
	}

	// A11: model, level, main label and status dot live in the footer, not the agent panel header.
	{
		for (const collapsed of [false, true]) {
			const top = stripAnsi(draw("eyecare-warm", "unicode", 100, CALLS, collapsed)[0]);
			assert("agent panel has no model/level/main label", !/glm-5\.3|max|main|●| · /.test(top), JSON.stringify(top));
			assert("agent panel keeps the fold marker on the right", /\[(?:\+|-)\] ─╮$/.test(top), JSON.stringify(top));
		}
	}

	// A12: the icon sets. Only nerd and unicode draw the agent glyph; none draws no glyph.
	{
		const nerd = draw("eyecare-warm", "nerd", 100, CALLS, true).join("");
		const uni = stripAnsi(draw("eyecare-warm", "unicode", 100, CALLS, true).join(""));
		const none = stripAnsi(draw("eyecare-warm", "none", 100, CALLS, true).join(""));
		assert("agent panel nerd draws no duplicate model glyph", !nerd.includes("\u{F06A9}"));
		assert("agent panel nerd keeps the collapsed call-count glyph", nerd.includes(""));
		assert("agent panel unicode draws no Nerd glyph", !uni.includes("\u{F06A9}") && !uni.includes(""));
		assert("agent panel none draws no agent glyph", !none.includes("") && !none.includes("agents"), JSON.stringify(none));
	}

	// A13: the store. Start, end, the running flag and explicit session reset.
	{
		const store = ap.createAgentPanelStore();
		store.start({ toolCallId: "x", toolName: "bash", args: {} }, "/tmp", 1000);
		assert("agent store records a call", store.size() === 1 && store.running());
		store.end({ toolCallId: "x", isError: false, durationMs: 250 }, 1250);
		const done = store.list()[0];
		assert("agent store keeps the final duration", done?.durationMs === 250 && done?.status === "done", JSON.stringify(done));
		assert("agent store reports no running call", !store.running());
		store.start({ toolCallId: "y", toolName: "read", args: {}, parentToolCallId: "x" }, "/tmp", 2000);
		assert("agent store keeps the parent", store.list()[1]?.parentId === "x");
		store.clear();
		assert("agent store clears the turn", store.size() === 0);
	}

	// A14: the collapsed flag survives a new component, so a reload keeps the fold.
	{
		const store = ap.createAgentPanelStore();
		store.start({ toolCallId: "x", toolName: "bash", args: {} }, "/tmp", NOW);
		store.collapsed = true;
		assert("agent store keeps the fold state", store.collapsed === true);
	}
}

// Print results
const renderCases = THEMES.length * ICONS.length * MODES.length * Object.keys(SCENARIOS).length * WIDTHS.length;
console.log(`\nrenderCases: ${renderCases}`);
console.log(`assertionCount: ${pass + fail}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (failures.length > 0) {
	console.log(`\nFailures (first 50):`);
	failures.slice(0, 50).forEach((f) => console.log(" ", f));
	if (failures.length > 50) console.log(`  ... and ${failures.length - 50} more`);
}

// Write samples (all 4 styles included via MODES)
const samplesPath =
	process.env.FOOTER_SAMPLES ?? path.join(os.tmpdir(), "warm-styles-samples.json");
fs.mkdirSync(path.dirname(samplesPath), { recursive: true });
fs.writeFileSync(samplesPath, JSON.stringify(samples, null, 2));
console.log(`\nSamples written to ${samplesPath} (${Object.keys(samples).length} entries)`);

// Live-theme proxy regression: swap theme behind a Proxy, verify bg color follows.
{
	const { loadTs } = await import(path.join(__dirname, "lib/pi-resolve.mjs"));
	const { loadTheme, BASE } = await import(path.join(__dirname, "lib/fixtures.mjs"));
	const mod = await loadTs(path.join(EXT_DIR, "warm-ui/footer.ts"));
	let current = loadTheme(REPO, "eyecare-warm");
	const themeProxy = new Proxy({}, { get: (_t, prop) => current[prop] });
	const s = BASE;
	const ctx = {
		sessionManager: { getEntries: () => [], getCwd: () => s.cwd, getSessionName: () => undefined },
		getContextUsage: () => ({ contextWindow: 1_000_000, percent: 62 }),
		model: { contextWindow: 1_000_000 },
	};
	const deps = {
		config: { enabled: true, hideStatuses: [], icons: "nerd", statusBar: "band", tools: true, userMessages: true, prompt: "❯" },
		git: { status: undefined, refresh() {} },
		agents: () => 0,
		onRender() {},
	};
	const fd = { onBranchChange: () => () => {}, getGitBranch: () => "main", getExtensionStatuses: () => new Map() };
	const proxyFooter = mod.createFooter(ctx, deps)({ requestRender() {} }, themeProxy, fd);
	const bgOf = (line) => (line.match(/\x1b\[(?:[0-9;]*;)?48;2;(\d+;\d+;\d+)m/) || [])[1];
	const lineA = proxyFooter.render(100)[1];
	const bgA = bgOf(lineA);
	current = loadTheme(REPO, "warm-sand");
	const lineB = proxyFooter.render(100)[1];
	const bgB = bgOf(lineB);
	const proxyOk = bgA !== bgB && bgA === "52;48;42" && bgB === "239;228;208";
	console.log(`\nProxy regression: eyecare-warm bg=${bgA} (expected 52;48;42), warm-sand bg=${bgB} (expected 239;228;208)`);
	if (proxyOk) {
		console.log("  proxy OK: band bg follows theme swap");
		pass++;
	} else {
		fail++;
		failures.push(`FAIL: proxy live-theme — eyecare-warm bg=${bgA} warm-sand bg=${bgB}`);
		console.log("  proxy FAIL: band bg did not follow theme swap");
	}
}

process.exit(fail > 0 ? 1 : 0);
