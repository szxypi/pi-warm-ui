# pi-warm-ui

Warm, low-glare themes and a calmer transcript for the [pi coding agent](https://github.com/earendil-works/pi): compact tool rows, readable subagent runs and a colorful one-line status bar.

[中文说明](README.zh-CN.md)

| Dark (`eyecare-warm`) | Light (`eyecare-warm-light`) |
|---|---|
| ![Dark theme](docs/screenshot-dark.png) | ![Light theme](docs/screenshot-light.png) |

![Subagent runs](docs/screenshot-subagent.png)

The screenshots use `"icons": "nerd"` and the JetBrainsMono Nerd Font.

## What you get

**Two themes**

- `eyecare-warm`: a dark theme on a warm brown background (`#262320`).
- `eyecare-warm-light`: a light theme on a warm paper background (`#F5EFE4`).
- Each theme has one accent color, amber. Headings, list bullets and the selected menu item use it.
- Body text has a contrast ratio of at least 7.9:1 on every panel. Secondary text has at least 4.5:1.
- The editor border shows the thinking level as a cool-to-warm ramp: off (gray), low (blue-gray), medium (teal), high (sage), xhigh (straw) and max (orange).

**Tool rows**

- Each tool call is one header line: a status dot, the tool name and a one-line summary. The output sits in a gutter below.

  ```
  ● edit  src/rate-limit.js                          +1 −1 · 0.2s
  │  -11     return entry.count <= limit + 1;
  │  +11     return entry.count <= limit;
  ```

- The dot is dim while the arguments stream, amber while the tool runs, green when it is done and red when it fails.
- The right side shows the duration of a live run, the diff stats of an edit, the line count of a read and the exit code of a failed command.
- Shell commands lose a leading `cd <working directory> &&`. Paths inside the working directory are relative.
- Result bodies come from each tool's own renderer, so previews, diffs, syntax highlighting and `ctrl+o` expansion keep working. Other tools (MCP, extensions) get the same header and gutter.

**Subagent runs**

For the `subagent` tool of [pi-code](https://www.npmjs.com/package/pi-code), and for tools with the same result shape:

- A single run shows the agent, the model, its usage, its latest tool calls and the first lines of its answer.
- Parallel and chain runs show one row per run: status, agent, task and usage. A running row shows its latest tool call underneath. A failed row shows its error.
- `ctrl+o` expands every run: the full task, all tool calls and the answer as Markdown.

**User messages**

- Your messages get an amber bar on the left edge of their panel, so they are easy to find when you scroll.

**Status bar**

- The bottom border of the editor shows the model and the thinking level. In bash mode (`!` or `!!`), it shows `bash` or `bash · no context`. The top border keeps pi's own working status.
- The footer is one line. Each segment has its own color:

  | Segment | Color |
  |---|---|
  | Directory (parent path dim, current folder bold) | blue |
  | Git branch | purple |
  | Session name | gray |
  | Input and output tokens | cyan |
  | Cache hit rate of the last request | green |
  | Session cost | yellow |
  | Context meter | green up to 50%, yellow up to 70%, orange up to 90%, then red |

- With `"icons": "nerd"`, each segment also gets a Nerd Font icon.
- When the terminal is narrow, the footer drops parts in this order: cache rate, session name, tokens, meter, long context text, cost.
- Extension statuses (for example goal or plan mode) go on a second line. This line shows only when a status exists.

## Install

Requires pi 1.0 or later. It was tested with pi 1.0.2.

1. Install the package:

   ```bash
   pi install git:github.com/szxypi/pi-warm-ui
   ```

   To pin a version, add a tag: `git:github.com/szxypi/pi-warm-ui@v0.2.0`.

2. Start pi. The layout is active immediately.
3. Open `/settings`, select **Theme**, then select `eyecare-warm` or `eyecare-warm-light`.
4. If your terminal uses a [Nerd Font](https://www.nerdfonts.com/), create `~/.pi/agent/warm-ui.json` with `{ "icons": "nerd" }`, then run `/reload`.

To follow the light or dark appearance of your terminal, set this in `~/.pi/agent/settings.json`:

```json
{ "theme": "eyecare-warm-light/eyecare-warm" }
```

To try the package for one session without installing it:

```bash
pi -e git:github.com/szxypi/pi-warm-ui
```

## Match your terminal (optional)

pi does not paint the terminal background. The themes look best when the terminal background and palette match. The `terminal/` folder has ready-made color schemes:

| File | Terminal |
|---|---|
| `terminal/windows-terminal.json` | Windows Terminal. Copy both objects into `"schemes"` in `settings.json`. |
| `terminal/ghostty-eyecare-warm`, `terminal/ghostty-eyecare-warm-light` | Ghostty. Copy into `~/.config/ghostty/themes/`. |
| `terminal/kitty-eyecare-warm.conf`, `terminal/kitty-eyecare-warm-light.conf` | kitty. Add `include <file>` to `kitty.conf`. |

For other terminals, use these core values:

| Scheme | Background | Foreground | Cursor | Selection |
|---|---|---|---|---|
| EyeCare Warm | `#262320` | `#D3CBBF` | `#E2B86A` | `#4A443C` |
| EyeCare Warm Light | `#F5EFE4` | `#3B352E` | `#93600F` | `#DCD0BC` |

The 16 ANSI colors are in `terminal/windows-terminal.json`.

## Configure

The extension reads `~/.pi/agent/warm-ui.json` when pi starts and on `/reload`. The file is optional. These are the defaults:

```json
{
  "enabled": true,
  "contextMeter": true,
  "hideStatuses": ["pi-code-status"],
  "tools": true,
  "userMessages": true,
  "icons": "unicode"
}
```

| Key | Effect |
|---|---|
| `enabled` | `false` keeps pi's own footer and editor. |
| `contextMeter` | `false` shows the context percentage without the meter. |
| `hideStatuses` | Status keys that the footer does not show. |
| `tools` | `false` keeps pi's own tool boxes, including subagent runs. |
| `userMessages` | `false` removes the bar on user messages. |
| `icons` | `"nerd"` uses Nerd Font icons. `"unicode"` uses plain symbols and short labels. `"none"` uses labels only. |

The themes work with any of these settings.

`pi-code-status` is hidden by default. The [pi-code](https://www.npmjs.com/package/pi-code) package uses it to mirror a Claude Code `statusLine`, which repeats the model and the context usage. To show it again, set `"hideStatuses": []`.

If you set `PI_CODING_AGENT_DIR`, the extension reads `warm-ui.json` from that directory.

## Commands

| Command | Effect |
|---|---|
| `/warm-ui off` | Restore pi's own footer, editor, tool rows and user messages until pi exits. |
| `/warm-ui on` | Turn the layout on again. |
| `/warm-ui` | Show the current state. |

Tool rows that are already on screen keep their style. Run `/reload` to redraw them.

## Uninstall

```bash
pi remove git:github.com/szxypi/pi-warm-ui
```

If your `theme` setting names one of these themes, pi falls back to its `system` theme after the removal. Select another theme in `/settings`.

## License

[MIT](LICENSE)
