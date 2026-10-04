import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GitStatus {
	staged: number;
	unstaged: number;
	untracked: number;
	ahead: number;
	behind: number;
}

export function isDirty(s: GitStatus | undefined): boolean {
	return !!s && s.staged + s.unstaged + s.untracked > 0;
}

function parse(out: string): GitStatus {
	const s: GitStatus = { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
	for (const line of out.split("\n")) {
		if (line.startsWith("## ")) {
			s.ahead = Number(line.match(/ahead (\d+)/)?.[1] ?? 0);
			s.behind = Number(line.match(/behind (\d+)/)?.[1] ?? 0);
			continue;
		}
		if (line.length < 3) continue;
		const [x, y] = line;
		if (x === "?" && y === "?") s.untracked++;
		else {
			if (x !== " " && x !== "!") s.staged++;
			if (y !== " " && y !== "!") s.unstaged++;
		}
	}
	return s;
}

const same = (a?: GitStatus, b?: GitStatus) => JSON.stringify(a) === JSON.stringify(b);

/** Counts of staged, modified and untracked files, plus ahead/behind, refreshed in the background. */
export class GitTracker {
	status?: GitStatus;
	private running = false;
	private again = false;
	private timer?: ReturnType<typeof setInterval>;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly cwd: () => string,
		private readonly onChange: () => void,
	) {}

	refresh(): void {
		if (this.running) {
			this.again = true;
			return;
		}
		this.running = true;
		// --no-optional-locks keeps this read from competing with the agent's own git commands for index.lock.
		this.pi
			.exec("git", ["--no-optional-locks", "status", "--porcelain=v1", "--branch"], { cwd: this.cwd(), timeout: 3000 })
			.then((result) => {
				const next = result.code === 0 ? parse(result.stdout) : undefined;
				if (!same(next, this.status)) {
					this.status = next;
					this.onChange();
				}
			})
			.catch(() => {})
			.finally(() => {
				this.running = false;
				if (this.again) {
					this.again = false;
					this.refresh();
				}
			});
	}

	start(intervalMs: number): void {
		this.stop();
		this.refresh();
		this.timer = setInterval(() => this.refresh(), intervalMs);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
}
