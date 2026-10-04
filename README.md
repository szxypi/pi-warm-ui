# pi-warm-ui

Warm, low-glare themes and a quiet one-line footer for the [pi coding agent](https://github.com/earendil-works/pi).

[中文说明](README.zh-CN.md)

| Dark (`eyecare-warm`) | Light (`eyecare-warm-light`) |
|---|---|
| ![Dark theme](docs/screenshot-dark.png) | ![Light theme](docs/screenshot-light.png) |

The `~72 tok/s · TTFT` line in the screenshots comes from a different package, [`@pi-plugins/speed`](https://www.npmjs.com/package/@pi-plugins/speed).

## What you get

**Two themes**

- `eyecare-warm`: a dark theme on a warm brown background (`#262320`).
- `eyecare-warm-light`: a light theme on a warm paper background (`#F5EFE4`).
- Each theme has one accent color, amber. Headings, list bullets and the selected menu item use it.
- Body text has a contrast ratio of at least 7.9:1 on every panel. Secondary text has at least 4.5:1.
- The editor border shows the thinking level as a cool-to-warm ramp: off (gray), low (blue-gray), medium (teal), high (sage), xhigh (straw) and max (orange).

**A layout extension**

- The bottom border of the editor shows the model and the thinking level. In bash mode (`!` or `!!`), it shows `bash` or `bash · no context`.
- The top border of the editor keeps pi's own working status.
- The footer uses one line:

  ```
  ~/projects/acme-api  ⎇ feat/rate-limit        ↑3.1k ↓449 · cache 94% · ━━━━━━━━━━ 0.6% of 1M
  ```

  - Left: the working directory and the git branch. A long path loses its middle segments first, so the branch name stays visible.
  - Right: input and output tokens, the cache hit rate of the last request, the session cost, and a context meter.
  - The meter turns to the warning color above 70% and to the error color above 90%.
  - When the terminal is narrow, the footer drops parts in this order: cache rate, session name, tokens, meter, long context text, cost.
- Extension statuses (for example goal or plan mode) go on a second line. This line shows only when a status exists.

## Install

Requires pi 1.0 or later. It was tested with pi 1.0.2.

1. Install the package:

   ```bash
   pi install git:github.com/szxypi/pi-warm-ui
   ```

   To pin a version, add a tag: `git:github.com/szxypi/pi-warm-ui@v0.1.0`.

2. Start pi. The layout extension is active immediately.
3. Open `/settings`, select **Theme**, then select `eyecare-warm` or `eyecare-warm-light`.

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

The extension reads `~/.pi/agent/warm-ui.json` when pi starts. The file is optional. These are the defaults:

```json
{
  "enabled": true,
  "contextMeter": true,
  "hideStatuses": ["pi-code-status"]
}
```

| Key | Effect |
|---|---|
| `enabled` | `false` keeps pi's own footer and editor. The themes still work. |
| `contextMeter` | `false` shows the context percentage without the meter. |
| `hideStatuses` | Status keys that the footer does not show. |

`pi-code-status` is hidden by default. The [pi-code](https://www.npmjs.com/package/pi-code) package uses it to mirror a Claude Code `statusLine`, which repeats the model and the context usage. To show it again, set `"hideStatuses": []`.

If you set `PI_CODING_AGENT_DIR`, the extension reads `warm-ui.json` from that directory.

## Commands

| Command | Effect |
|---|---|
| `/warm-ui off` | Restore pi's own footer and editor for the current session. |
| `/warm-ui on` | Turn the layout on again. |
| `/warm-ui` | Show the current state. |

## Uninstall

```bash
pi remove git:github.com/szxypi/pi-warm-ui
```

If your `theme` setting names one of these themes, pi falls back to its `system` theme after the removal. Select another theme in `/settings`.

## License

[MIT](LICENSE)
