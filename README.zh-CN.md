# pi-warm-ui

给 [pi coding agent](https://github.com/earendil-works/pi) 用的暖色低眩光主题，外加一个安静的单行 footer。

[English](README.md)

| 深色（`eyecare-warm`） | 浅色（`eyecare-warm-light`） |
|---|---|
| ![深色主题](docs/screenshot-dark.png) | ![浅色主题](docs/screenshot-light.png) |

截图里 `~72 tok/s · TTFT` 那一行来自另一个包 [`@pi-plugins/speed`](https://www.npmjs.com/package/@pi-plugins/speed)，不属于本包。

## 包含什么

**两个主题**

- `eyecare-warm`：深色，暖棕底（`#262320`）。
- `eyecare-warm-light`：浅色，暖纸底（`#F5EFE4`）。
- 每个主题只有一个强调色：琥珀色。标题、列表符号和菜单里的选中项用它。
- 正文在所有面板上的对比度不低于 7.9:1，次要文字不低于 4.5:1。
- 输入框边框按思考等级从冷到暖变色：off 灰、low 蓝灰、medium 青、high 草绿、xhigh 麦黄、max 橙。

**一个布局扩展**

- 输入框下边框显示模型和思考等级。在 bash 模式（`!` 或 `!!`）下改为显示 `bash` 或 `bash · no context`。
- 输入框上边框保留 pi 自带的工作状态。
- footer 只占一行：

  ```
  ~/projects/acme-api  ⎇ feat/rate-limit        ↑3.1k ↓449 · cache 94% · ━━━━━━━━━━ 0.6% of 1M
  ```

  - 左边是工作目录和 git 分支。路径太长时先省略中间几段，保证分支名可见。
  - 右边依次是输入/输出 token、最近一次请求的缓存命中率、会话费用和上下文用量条。
  - 上下文超过 70% 时用量条变成 warning 色，超过 90% 时变成 error 色。
  - 终端太窄时，footer 按以下顺序隐藏内容：缓存命中率、会话名、token、用量条、上下文总量、费用。
- 扩展状态（例如 goal、plan mode）显示在第二行。没有状态时不显示这一行。

## 安装

需要 pi 1.0 或更高版本。已在 pi 1.0.2 上测试。

1. 安装这个包：

   ```bash
   pi install git:github.com/szxypi/pi-warm-ui
   ```

   要固定版本，就在后面加 tag：`git:github.com/szxypi/pi-warm-ui@v0.1.0`。

2. 启动 pi。布局扩展立即生效。
3. 打开 `/settings`，选择 **Theme**，再选择 `eyecare-warm` 或 `eyecare-warm-light`。

要让主题跟随终端的深浅色，在 `~/.pi/agent/settings.json` 里这样设置：

```json
{ "theme": "eyecare-warm-light/eyecare-warm" }
```

只想在一次会话里试用、不安装：

```bash
pi -e git:github.com/szxypi/pi-warm-ui
```

## 配合终端配色（可选）

pi 不绘制终端背景。终端的背景和调色板与主题一致时效果最好。`terminal/` 目录里有现成的配色方案：

| 文件 | 终端 |
|---|---|
| `terminal/windows-terminal.json` | Windows Terminal。把两个对象复制到 `settings.json` 的 `"schemes"` 里。 |
| `terminal/ghostty-eyecare-warm`、`terminal/ghostty-eyecare-warm-light` | Ghostty。复制到 `~/.config/ghostty/themes/`。 |
| `terminal/kitty-eyecare-warm.conf`、`terminal/kitty-eyecare-warm-light.conf` | kitty。在 `kitty.conf` 里加 `include <文件>`。 |

其他终端按下表设置核心颜色：

| 配色 | 背景 | 前景 | 光标 | 选区 |
|---|---|---|---|---|
| EyeCare Warm | `#262320` | `#D3CBBF` | `#E2B86A` | `#4A443C` |
| EyeCare Warm Light | `#F5EFE4` | `#3B352E` | `#93600F` | `#DCD0BC` |

16 个 ANSI 颜色见 `terminal/windows-terminal.json`。

## 配置

pi 启动时，扩展读取 `~/.pi/agent/warm-ui.json`。这个文件可以不建。默认值如下：

```json
{
  "enabled": true,
  "contextMeter": true,
  "hideStatuses": ["pi-code-status"]
}
```

| 键 | 作用 |
|---|---|
| `enabled` | 设为 `false` 时保留 pi 自带的 footer 和输入框。主题照常可用。 |
| `contextMeter` | 设为 `false` 时只显示上下文百分比，不显示用量条。 |
| `hideStatuses` | footer 不显示的状态键。 |

`pi-code-status` 默认隐藏。[pi-code](https://www.npmjs.com/package/pi-code) 用这个状态转发 Claude Code 的 `statusLine`，内容和本 footer 的模型、上下文重复。要重新显示它，设置 `"hideStatuses": []`。

如果设置了 `PI_CODING_AGENT_DIR`，扩展从那个目录读取 `warm-ui.json`。

## 命令

| 命令 | 作用 |
|---|---|
| `/warm-ui off` | 在当前会话恢复 pi 自带的 footer 和输入框。 |
| `/warm-ui on` | 重新启用布局。 |
| `/warm-ui` | 显示当前状态。 |

## 卸载

```bash
pi remove git:github.com/szxypi/pi-warm-ui
```

如果 `theme` 设置的是本包的主题，卸载后 pi 会回退到 `system` 主题。到 `/settings` 里另选一个主题即可。

## 许可证

[MIT](LICENSE)
