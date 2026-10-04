/**
 * User messages get an accent bar on the left edge of their panel:
 *
 *   ▌ Fix the off-by-one bug in src/rate-limit.js
 *
 * pi has no renderer hook for user messages, so this wraps UserMessageComponent.render.
 * The wrapper is installed once per process. A reload replaces only the shared hooks below,
 * so the newest extension instance always decides whether the bar shows.
 */
import { type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";

interface Hooks {
	enabled: () => boolean;
	theme: () => Theme | undefined;
}

interface Patched {
	hooks: Hooks;
}

const KEY = Symbol.for("pi-warm-ui.user-message");
// Shell integration marks (OSC 133) stay at the very start of a line.
const ZONE_MARKS = /^(?:\x1b\]133;[A-Z]\x07)*/;

export function installUserMessageBar(hooks: Hooks): void {
	const proto = (UserMessageComponent as unknown as { prototype?: Record<PropertyKey, unknown> } | undefined)?.prototype;
	if (!proto || typeof proto.render !== "function") return;
	const existing = proto[KEY] as Patched | undefined;
	if (existing) {
		existing.hooks = hooks;
		return;
	}
	const patched: Patched = { hooks };
	const original = proto.render as (this: unknown, width: number) => string[];
	proto.render = function (this: unknown, width: number): string[] {
		const theme = patched.hooks.theme();
		if (!patched.hooks.enabled() || !theme || width < 10) return original.call(this, width);
		const bar = theme.style("▌", { fg: "accent", bg: "userMessageBg" });
		return original.call(this, width - 1).map((line) => {
			const marks = line.match(ZONE_MARKS)?.[0] ?? "";
			return marks + bar + line.slice(marks.length);
		});
	};
	proto[KEY] = patched;
}
