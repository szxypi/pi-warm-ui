// Harness fixtures: build Footer instances from real Theme objects.
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { PI_PKG, loadTs } from "./pi-resolve.mjs";

const themeMod = await import(
	pathToFileURL(
		path.join(PI_PKG, "dist/modes/interactive/theme/theme.js")
	).href
);
const tui = await import(
	pathToFileURL(
		path.join(PI_PKG, "node_modules/@earendil-works/pi-tui/dist/index.js")
	).href
);
export const { visibleWidth, truncateToWidth, stripTerminalSequences } = tui;

export const THEMES = [
	"eyecare-warm",
	"eyecare-warm-light",
	"warm-mahogany",
	"warm-gruvbox",
	"warm-sand",
];
export const ICONS = ["nerd", "unicode", "none"];
/** The one-line styles. "panel" draws three rows and has its own block in test-footer.mjs. */
export const MODES = ["band", "plain", "bar", "rail"];

const themeCache = new Map();
export function loadTheme(repo, name) {
	const key = `${repo}::${name}`;
	if (!themeCache.has(key)) {
		themeCache.set(
			key,
			themeMod.loadThemeFromPath(
				path.join(repo, "themes", `${name}.json`),
				"truecolor"
			)
		);
	}
	return themeCache.get(key);
}

export const BASE = {
	cwd: "/home/user/projects/acme-api",
	branch: "feat/rate-limit",
	git: { staged: 1, unstaged: 1, untracked: 1, ahead: 0, behind: 0 },
	sessionName: undefined,
	agents: 0,
	usage: {
		input: 617_000,
		output: 720,
		cacheRead: 480_000,
		cacheWrite: 0,
		cost: 0.01,
	},
	contextPct: 62,
	contextWindow: 1_000_000,
	statuses: {},
	/** ctx.model.id. The panel draws it on the top border. */
	modelId: "glm-5.3",
	/** ctx.model.reasoning. false means the model does not think, so no level shows. */
	reasoning: true,
	/** ctx.thinkingLevel. "off" hides the level, like a reasoning model with thinking turned off. */
	thinkingLevel: "max",
};

export const SCENARIOS = {
	normal: { ...BASE },
	"normal-session": { ...BASE, sessionName: "rate limit fix", agents: 2 },
	nogit: { ...BASE, branch: null, git: undefined },
	nocontext: { ...BASE, contextPct: undefined, contextWindow: undefined },
	"ctx-unknown-pct": { ...BASE, contextPct: null },
	longnames: {
		...BASE,
		cwd: "/home/user/projects/an-extremely-long-project-directory-name-for-testing",
		branch: "feature/ABC-12345-implement-a-very-long-branch-name-with-many-segments",
		git: { staged: 12, unstaged: 34, untracked: 5, ahead: 3, behind: 2 },
		sessionName: "a long session name that goes on and on",
		agents: 3,
	},
	cjk: {
		...BASE,
		cwd: "/home/user/projects/智能报价系统",
		branch: "功能/限流修复",
		sessionName: "限流修复与回归测试",
		agents: 2,
	},
	emoji: {
		...BASE,
		cwd: "/home/user/projects/rocket-🚀-app",
		branch: "feat/🔥-hotfix",
		sessionName: "🎯 deploy 👩‍💻",
	},
	highctx: {
		...BASE,
		contextPct: 93,
		usage: { ...BASE.usage, input: 930_000, cost: 12.3456 },
	},
	"ctx-warn": { ...BASE, contextPct: 75 },
	"ctx-mid": { ...BASE, contextPct: 55 },
	"ctx-low": { ...BASE, contextPct: 4.25 },
	home: { ...BASE, cwd: os.homedir(), branch: null, git: undefined },
	"status-line": {
		...BASE,
		statuses: {
			goal: "goal: ship v2",
			"pi-code-status": "hidden one",
			plan: "plan mode",
		},
	},
	"multi-agent": { ...BASE, agents: 12, sessionName: "swarm" },
	clean: {
		...BASE,
		git: { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 },
	},
	"ahead-behind": {
		...BASE,
		git: { staged: 0, unstaged: 2, untracked: 0, ahead: 3, behind: 1 },
	},
	/** A model that does not think, so the top border shows the model name only. */
	"no-thinking": { ...BASE, reasoning: false, thinkingLevel: "off" },
	/** A reasoning model with thinking turned off: the level is hidden, the model name stays. */
	"thinking-off": { ...BASE, thinkingLevel: "off" },
	/** A long model id, to exercise the clip. */
	"long-model": {
		...BASE,
		modelId: "claude-opus-5-5-xhigh-super-long-variant-name",
		sessionName: "a long session name that goes on and on",
	},
};

export async function makeFooter({
	extDir,
	repo,
	themeName,
	icons,
	statusBar,
	scenario,
	hideStatuses = ["pi-code-status"],
}) {
	const mod = await loadTs(path.join(extDir, "warm-ui/footer.ts"));
	const theme = loadTheme(repo, themeName);
	const s = { ...BASE, ...scenario };
	const entries = [
		{
			type: "message",
			message: {
				role: "assistant",
				usage: {
					input: s.usage.input,
					output: s.usage.output,
					cacheRead: s.usage.cacheRead,
					cacheWrite: s.usage.cacheWrite,
					cost: { total: s.usage.cost },
				},
			},
		},
	];
	if (!s.usage.input && !s.usage.output && !s.usage.cost) entries.length = 0;
	const ctx = {
		sessionManager: {
			getEntries: () => entries,
			getCwd: () => s.cwd,
			getSessionName: () => s.sessionName,
		},
		getContextUsage: () =>
			s.contextWindow === undefined
				? undefined
				: { contextWindow: s.contextWindow, percent: s.contextPct, tokens: null },
		model:
			s.contextWindow === undefined && !s.modelId
				? undefined
				: {
						contextWindow: s.contextWindow,
						id: s.modelId,
						name: s.modelId,
						reasoning: s.reasoning,
					},
		// pi exposes the level as a getter, so a stale read throws instead of returning a value.
		get thinkingLevel() {
			return s.thinkingLevel;
		},
	};
	const deps = {
		config: {
			enabled: true,
			hideStatuses,
			tools: true,
			userMessages: true,
			icons,
			statusBar,
			prompt: "❯",
		},
		git: { status: s.git, refresh() {} },
		agents: () => s.agents,
		onRender() {},
	};
	const footerData = {
		onBranchChange: () => () => {},
		getGitBranch: () => s.branch ?? undefined,
		getExtensionStatuses: () => new Map(Object.entries(s.statuses)),
	};
	const factory = mod.createFooter(ctx, deps);
	return factory({ requestRender() {} }, theme, footerData);
}

export const esc = (s) => s.replace(/\x1b/g, "␛");
