/** Display-only roster. Ordinary tools are never agents, and an async launch receipt is not success. */
import fs from "node:fs/promises";
import path from "node:path";

export type AgentStatus = "idle" | "pending" | "running" | "done" | "error" | "stopped";
export interface PanelAgent {
	id: string;
	name: string;
	model?: string;
	effort?: string;
	status: AgentStatus;
	/** Only nested subagents have a parent. Main and directly delegated agents stay flush-left. */
	parentId?: string;
	durationMs?: number;
}
interface Group {
	id: string;
	rows: Map<string, PanelAgent>;
	detached: boolean;
	terminal: boolean;
	asyncDir?: string;
}
const text = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v.trim() : undefined;
const busy = (s: AgentStatus) => s === "running" || s === "pending";
export const AGENT_PANEL_FRAME_MS = 100;

/** Strip only an explicit thinking suffix, never a model-name suffix such as '-high'. */
export function modelParts(model?: string, effort?: string): { model?: string; effort?: string } {
	const match = model?.match(/:(off|minimal|low|medium|high|xhigh|max)$/i);
	return { model: match ? model!.slice(0, -match[0].length) : model, effort: effort ?? match?.[1] };
}
export function displayModel(model?: string): string {
	return modelParts(model).model?.split("/").pop()?.replace(/[-_]+/g, " ").toUpperCase() || "…";
}
function statusOf(row: any, fallback: AgentStatus): AgentStatus {
	if (row.stopped || row.interrupted || row.status === "stopped" || row.state === "stopped" || row.stopReason === "aborted") return "stopped";
	if (row.error || row.errorMessage || row.success === false || row.stopReason === "error" || ["failed", "rejected", "error"].includes(row.status ?? row.state)) return "error";
	if (["partial", "paused"].includes(row.status ?? row.state)) return "stopped";
	if (["complete", "completed", "done"].includes(row.status ?? row.state) || row.success === true) return "done";
	if (["pending", "queued"].includes(row.status ?? row.state)) return "pending";
	if (["running", "started", "stopping"].includes(row.status ?? row.state) || row.exitCode === -1 || row.exitCode === null) return "running";
	if (typeof row.exitCode === "number") return row.exitCode === 0 ? "done" : "error";
	return fallback;
}

export function createAgentPanelStore() {
	const groups = new Map<string, Group>();
	const aliases = new Map<string, string>();
	let active = false;
	let mainStatus: AgentStatus = "idle";
	let frozenPhase = 0;
	let polling = false;
	let epoch = 0;
	const running = () => active || [...groups.values()].some((g) => (g.detached && !g.terminal) || [...g.rows.values()].some((r) => busy(r.status)));
	const phase = (now: number) => running() ? Math.floor(now / AGENT_PANEL_FRAME_MS) : frozenPhase;
	const change = (now: number, fn: () => void) => {
		const wasRunning = running();
		const before = phase(now);
		fn();
		if (wasRunning && !running()) frozenPhase = before;
	};
	const groupFor = (id: string, toolCallId?: string): Group => {
		const direct = groups.get(aliases.get(id) ?? id);
		const tool = toolCallId ? groups.get(aliases.get(toolCallId) ?? toolCallId) : undefined;
		const group = direct ?? tool ?? { id, rows: new Map(), detached: false, terminal: false };
		if (direct && tool && direct !== tool) {
			for (const [key, row] of tool.rows) {
				const current = direct.rows.get(key);
				direct.rows.set(key, current ? { ...row, ...current, model: current.model ?? row.model, effort: current.effort ?? row.effort } : row);
			}
			for (const [alias, target] of aliases) if (target === tool.id) aliases.set(alias, direct.id);
			groups.delete(tool.id);
		}
		groups.set(group.id, group);
		aliases.set(id, group.id);
		if (toolCallId) aliases.set(toolCallId, group.id);
		return group;
	};
	const ingest = (group: Group, rows: any[], fallback: AgentStatus, parentKey?: string, depth = 0) => {
		if (depth > 8) return;
		rows.slice(0, 128).forEach((row, index) => {
			if (!row || typeof row !== "object") return;
			const name = text(row.agent) ?? text(row.name);
			if (!name || name === "workflow") return;
			const ownKey = String(row.workflowKey ?? row.index ?? row.stepIndex ?? row.childId ?? index);
			const key = parentKey ? `${parentKey}>${ownKey}` : ownKey;
			const prev = group.rows.get(key);
			if (row.detached) group.detached = true;
			const model = text(row.resolvedModel?.model) ?? text(row.model) ?? text(row.launchModel) ?? text(row.requestedModel) ?? prev?.model;
			const parts = modelParts(model, text(row.thinking) ?? text(row.effort) ?? prev?.effort);
			const durationMs = row.durationMs ?? row.progress?.durationMs ?? (typeof row.endedAt === "number" && typeof row.startedAt === "number" ? row.endedAt - row.startedAt : prev?.durationMs);
			group.rows.set(key, {
				id: `${group.id}/${key}`, name, ...parts, status: row.detached && !group.terminal ? "running" : statusOf(row, fallback), durationMs,
				parentId: parentKey ? `${group.id}/${parentKey}` : undefined,
			});
			// Nested runs may have several steps. Keep their real parent rather than flattening them.
			if (Array.isArray(row.children)) row.children.slice(0, 128).forEach((child: any, childIndex: number) => {
				if (!child || typeof child !== "object") return;
				const runKey = `${text(child.id) ?? childIndex}`;
				const children = Array.isArray(child.steps) && child.steps.length ? child.steps : [child];
				ingest(group, children.map((step: any, stepIndex: number) => ({ ...step, index: `${runKey}:${stepIndex}` })), statusOf(child, "running"), key, depth + 1);
			});
		});
	};
	const observe = (data: any, now: number, scope?: string, toolCallId?: string, final = false, isError = false) => {
		if (!data || typeof data !== "object") return;
		const id = text(data.runId) ?? text(data.asyncId) ?? scope ?? toolCallId;
		if (!id) return;
		change(now, () => {
			const group = groupFor(id, text(data.toolCallId) ?? toolCallId);
			if (text(data.asyncDir)) { group.asyncDir = data.asyncDir; group.detached = true; }
			if (data.asyncId || data.background) group.detached = true;
			const state = statusOf(data, final && !group.detached ? (isError ? "error" : "done") : "running");
			if (group.terminal && busy(state)) return; // Ignore a stale in-flight status-file read.
			if (!busy(state)) group.terminal = true;
			const rows = Array.isArray(data.steps) ? data.steps.map((row: any, index: number) => ({ ...row, index: row.index ?? index })) : Array.isArray(data.results) ? data.results : [];
			ingest(group, rows, busy(state) ? "running" : state);
			// Terminal run state is authoritative even if its last child snapshot still said running.
			if (group.terminal) for (const row of group.rows.values()) if (busy(row.status)) row.status = state;
		});
	};
	const store = {
		collapsed: false,
		mainStatus: () => mainStatus,
		knows: (id: string) => groups.has(aliases.get(id) ?? id),
		running,
		phase,
		list: () => [...groups.values()].flatMap((g) => [...g.rows.values()]),
		size: () => store.list().length,
		begin(now: number) {
			change(now, () => {
				if (!active) {
					// A new prompt must not lose children that are still running in the background.
					for (const [id, group] of groups) if (![...group.rows.values()].some((r) => busy(r.status)) && (!group.detached || group.terminal)) groups.delete(id);
				}
				active = true;
				mainStatus = "running";
			});
		},
		settle(now: number, aborted = false) {
			change(now, () => {
				active = false;
				mainStatus = aborted ? "stopped" : "done";
				for (const group of groups.values()) if (!group.detached) {
					for (const row of group.rows.values()) if (busy(row.status)) row.status = "stopped";
				}
			});
		},
		start(event: { toolCallId: string; toolName: string; args: any }, now: number) {
			const args = event.args ?? {};
			if (event.toolName !== "subagent" || args.action || args.status || args.cancel) return;
			const tasks = Array.isArray(args.tasks) ? args.tasks : Array.isArray(args.args?.tasks) ? args.args.tasks : Array.isArray(args.chain) ? args.chain : args.agent ? [args] : [];
			if (!tasks.length) return; // A workflow controller is not a child agent.
			change(now, () => {
				const group = groupFor(event.toolCallId);
				ingest(group, tasks.map((task: any, index: number) => ({ ...task, index, model: task.model ?? args.model, thinking: task.thinking ?? args.thinking, status: args.chain && index > 0 ? "pending" : "running" })), "running");
			});
		},
		update(toolCallId: string, result: any, now: number, final = false, isError = false) {
			if (result?.details?.results?.some((row: any) => row?.detached)) groupFor(toolCallId).detached = true;
			observe(result?.details, now, toolCallId, toolCallId, final, isError);
			if (final && !result?.details) observe({}, now, toolCallId, toolCallId, true, isError);
		},
		observe,
		asyncStarted(data: any, now: number) {
			const id = text(data?.id) ?? text(data?.runId);
			if (!id) return;
			observe({ ...data, runId: id, background: true }, now);
			const group = groupFor(id);
			if (!group.rows.size) ingest(group, (data.agents ?? (data.agent ? [data.agent] : [])).map((agent: string) => ({ agent })), "running");
		},
		asyncComplete(data: any, now: number) {
			const id = text(data?.runId) ?? text(data?.id);
			if (id) observe({ ...data, runId: id, state: data.state ?? (data.success === false ? "failed" : "complete") }, now);
		},
		foregroundComplete(data: any, now: number) {
			if (!text(data?.runId) || !text(data?.agent)) return;
			change(now, () => {
				const group = groupFor(data.runId);
				ingest(group, [{ ...data, index: data.taskIndex ?? 0 }], data.success === false ? "error" : "done");
				if (![...group.rows.values()].some((row) => busy(row.status))) group.terminal = true;
			});
		},
		childStatus(data: any, now: number) {
			if (!text(data?.runId) || !text(data?.agent)) return;
			const group = groupFor(data.runId);
			if (text(data.asyncDir)) { group.asyncDir = data.asyncDir; group.detached = true; }
			change(now, () => ingest(group, [{ ...data, workflowKey: data.workflowKey ?? data.childId, status: data.status === "stopped" ? "stopped" : "running" }], "running"));
		},
		/** Read only the status files announced by this session's native subagent events/receipts. */
		async refresh(): Promise<boolean> {
			if (polling) return false;
			polling = true;
			const version = epoch;
			const before = JSON.stringify(store.list());
			try {
				for (const group of [...groups.values()].filter((g) => g.asyncDir && !g.terminal).slice(0, 32)) {
					try {
						const file = path.join(group.asyncDir!, "status.json");
						if ((await fs.stat(file)).size > 1024 * 1024) continue;
						const data = JSON.parse(await fs.readFile(file, "utf8"));
						if (epoch !== version) return false;
						observe(data, Date.now(), group.id);
					} catch { /* The runner may be atomically replacing its status file. */ }
				}
				return before !== JSON.stringify(store.list());
			} finally { polling = false; }
		},
		clear() {
			epoch++;
			groups.clear();
			aliases.clear();
			active = false;
			mainStatus = "idle";
			frozenPhase = 0;
		},
	};
	return store;
}
export type AgentPanelStore = ReturnType<typeof createAgentPanelStore>;
