# pi-warm-ui

Warm, low-glare themes and a calmer transcript for the [pi coding agent](https://github.com/earendil-works/pi): five warm themes, compact tool rows, readable subagent runs and a status bar in the style of [oh-my-pi](https://github.com/can1357/oh-my-pi).

[中文说明](README.zh-CN.md)

| Dark (`eyecare-warm`) | Light (`eyecare-warm-light`) |
|---|---|
| ![Dark theme](docs/screenshot-dark.png) | ![Light theme](docs/screenshot-light.png) |

![Subagent runs](docs/screenshot-subagent.png)

![All five themes](docs/themes.png)

The screenshots use `"icons": "nerd"` and the JetBrainsMono Nerd Font.

## What you get

**Five themes**

| Theme | Look | Origin |
|---|---|---|
| `eyecare-warm` | dark, warm brown (`#262320`) | this package |
| `eyecare-warm-light` | light, warm paper (`#F5EFE4`) | this package |
| `warm-mahogany` | dark, deep mahogany (`#181210`) | oh-my-pi `mahogany` |
| `warm-gruvbox` | dark, gruvbox (`#282828`) | oh-my-pi `dark-gruvbox` |
| `warm-sand` | light, cream (`#FFFAF0`) | oh-my-pi `light-sand` |

- oh-my-pi ships 100 themes. These three are the warm ones with the best contrast. They are renamed, and their colors are adjusted to this package's contrast standard.
- The standard: body text at least 7:1, secondary text, code, diffs and tool output at least 4.5:1, status colors at least 3:1.
- Each theme has a status bar palette (the colors of oh-my-pi's `statusLine*` tokens) and a matching terminal color scheme.
- The editor border shows the thinking level as a ramp of the theme's thinking colors.

**Tool rows**

- Each tool call is one header line: a status dot, the tool name and a one-line summary. The output sits below it, indented to start under the tool name.

  ```
  ● edit  src/rate-limit.js                          +1 −1 · 0.2s
  │  -11     return entry.count <= limit + 1;
  │  +11     return entry.count <= limit;
  ```

- The dot is dim while the arguments stream, amber while the tool runs, green when it is done and red when it fails.
- The right side shows the duration of a live run, the diff stats of an edit, the line count of a read and the exit code of a failed command.
- Shell commands lose a leading `cd <working directory> &&`. Paths inside the working directory are relative.
- Result bodies come from each tool's own renderer, so previews, diffs, syntax highlighting and `ctrl+o` expansion keep working. Other tools (MCP, extensions) get the same header and indented output.

**Subagent runs**

For the `subagent` tool of [pi-code](https://www.npmjs.com/package/pi-code), and for tools with the same result shape:

- A single run shows the agent, the model, its usage, its latest tool calls and the first lines of its answer.
- Parallel and chain runs show one row per run: status, agent, task and usage. A running row shows its latest tool call underneath. A failed row shows its error.
- `ctrl+o` expands every run: the full task, all tool calls and the answer as Markdown.

**User messages**

- Your messages get an amber bar on the left edge of their panel, so they are easy to find when you scroll.
- When thinking blocks are hidden (`hideThinkingBlock`), the `Thinking...` line gets an icon: a brain with `"icons": "nerd"`, `✻` with `"unicode"`, none with `"none"`.

**Status bar**

- The editor shows a prompt symbol `❯` before the input. Wrapped lines and the autocomplete list are indented to match. In bash mode the symbol takes the bash color.
- The bottom border of the editor shows the model and the thinking level. In bash mode (`!` or `!!`), it shows `bash` or `bash · no context`. The top border keeps pi's own working status.
- The footer is one line in two parts, drawn as pills on the theme's status bar background (after oh-my-pi):

  ```
   acme-api   feat/rate-limit +1 ~1 ?1                     2  617k  720   0.010   62% of 1M 
  ```

  - Left: the project directory name (not the full path) and the git branch. The branch turns from the clean color to the dirty color when files change. `+` counts staged files, `~` modified files, `?` untracked files, `▴`/`▾` commits ahead of and behind the upstream.
  - Right: running subagents (only while they run), the session name, input and output tokens, the cache hit rate of the last request, the session cost and the context usage.
  - The context percentage is green up to 50%, yellow up to 70%, orange up to 90%, then red.
- Each segment uses a color from the theme's status bar palette. A theme without a palette gets colors from its standard tokens.
- Git status refreshes every 10 seconds, after each turn and after `bash`, `edit` and `write` calls. It uses `git status --no-optional-locks`, so it does not lock the index.
- With `"icons": "nerd"`, segments get Nerd Font icons and the pills get rounded ends. `"statusBar": "plain"` draws the same segments without the background.
- When the terminal is narrow, the footer drops parts in this order: cache rate, session name, git counts, tokens, long context text, cost.
- Extension statuses (for example goal or plan mode) go on a second line. This line shows only when a status exists.

## Install

Requires pi 1.0 or later. It was tested with pi 1.0.2.

1. Install the package:

   ```bash
   pi install git:github.com/szxypi/pi-warm-ui
   ```

   To pin a version, add a tag: `git:github.com/szxypi/pi-warm-ui@v0.4.2`.

2. Start pi. The layout is active immediately.
3. Open `/settings`, select **Theme**, then select one of the five themes.
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
| `terminal/windows-terminal.json` | Windows Terminal. Copy the objects you want into `"schemes"` in `settings.json`. |
| `terminal/ghostty-<theme>` | Ghostty. Copy into `~/.config/ghostty/themes/`. |
| `terminal/kitty-<theme>.conf` | kitty. Add `include <file>` to `kitty.conf`. |

For other terminals, use these core values:

| Scheme | Background | Foreground |
|---|---|---|
| EyeCare Warm | `#262320` | `#D3CBBF` |
| EyeCare Warm Light | `#F5EFE4` | `#3B352E` |
| Warm Mahogany | `#181210` | `#ECE4D8` |
| Warm Gruvbox | `#282828` | `#EBDBB2` |
| Warm Sand | `#FFFAF0` | `#3E2723` |

The 16 ANSI colors are in `terminal/windows-terminal.json`.

## Configure

The extension reads `~/.pi/agent/warm-ui.json` when pi starts and on `/reload`. The file is optional. These are the defaults:

```json
{
  "enabled": true,
  "hideStatuses": ["pi-code-status"],
  "tools": true,
  "userMessages": true,
  "icons": "unicode",
  "statusBar": "band",
  "prompt": "❯"
}
```

| Key | Effect |
|---|---|
| `enabled` | `false` keeps pi's own footer and editor. |
| `hideStatuses` | Status keys that the footer does not show. |
| `tools` | `false` keeps pi's own tool boxes, including subagent runs. |
| `userMessages` | `false` removes the bar on user messages. |
| `prompt` | The symbol before the input, for example `">"` or `"›"`. `""` removes it. |
| `icons` | `"nerd"` uses Nerd Font icons. `"unicode"` uses plain symbols and short labels. `"none"` uses labels only. |
| `statusBar` | `"band"` draws the footer on the theme's status bar background. `"plain"` draws colored text only. |

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

## Credits

`warm-mahogany`, `warm-gruvbox` and `warm-sand`, and the status bar design, are adapted from [oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). `scripts/import-omp-themes.mjs` regenerates the three themes from an oh-my-pi checkout.

## License

[MIT](LICENSE)
