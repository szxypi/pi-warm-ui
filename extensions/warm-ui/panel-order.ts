/**
 * The agent panel stays at the bottom of the above-editor widget stack, directly above the input.
 *
 * pi renders above-editor widgets in mount order. pi-subagents mounts its async block only while a
 * background run exists, so that block appears after the panel and pushes the panel up. This wraps
 * InteractiveMode.renderWidgetContainer: when the panel key is present but not last, it rebuilds the
 * widget Map with the panel moved to the end. pi's own Map is never modified.
 * The wrapper is installed once per process. A reload replaces only the shared hooks below,
 * so the newest extension instance always decides whether the reorder shows.
 * If a hook throws while pi swaps the session, pi renders the widgets in their original order.
 */
import { InteractiveMode } from "@earendil-works/pi-coding-agent";

interface Hooks {
	/** The widget key that must be drawn last inside the above-editor stack. */
	key: string;
	/** Whether the panel is on. When off the widget is unmounted anyway, so reordering stays inert. */
	enabled: () => boolean;
}

interface Patched {
	hooks: Hooks;
}

type RenderContainer = (
	this: unknown,
	container: unknown,
	widgets: Map<string, unknown>,
	spacerWhenEmpty: boolean,
	leadingSpacer: boolean,
) => void;

const KEY = Symbol.for("pi-warm-ui.widget-order");

export function installPanelBottomOrder(hooks: Hooks): void {
	const proto = (InteractiveMode as unknown as { prototype?: Record<PropertyKey, unknown> } | undefined)?.prototype;
	const original = proto?.renderWidgetContainer;
	if (!proto || typeof original !== "function") return;
	const existing = proto[KEY] as Patched | undefined;
	if (existing) {
		existing.hooks = hooks;
		return;
	}
	const patched: Patched = { hooks };
	const render = original as RenderContainer;
	proto.renderWidgetContainer = function (
		this: unknown,
		container: unknown,
		widgets: Map<string, unknown>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void {
		let ordered: Map<string, unknown> | undefined;
		try {
			const { key, enabled } = patched.hooks;
			if (enabled() && widgets.size > 1 && widgets.has(key)) {
				const panel = widgets.get(key);
				let last: unknown;
				for (const component of widgets.values()) last = component;
				if (last !== panel) {
					ordered = new Map(widgets);
					ordered.delete(key);
					ordered.set(key, panel);
				}
			}
		} catch {
			ordered = undefined;
		}
		render.call(this, container, ordered ?? widgets, spacerWhenEmpty, leadingSpacer);
	};
	proto[KEY] = patched;
}
