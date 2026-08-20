---
name: herdr
description: "Control Herdr, a terminal multiplexer for coding agents. Use only when the user explicitly mentions Herdr or asks to use Herdr to inspect or control panes, tabs, workspaces, commands, or another agent. Do not use merely because a task could benefit from a background terminal, delegation, or parallel work. Requires HERDR_ENV=1."
---

# Herdr

Herdr organizes terminals into workspaces, tabs, and panes, recognizes coding agents running inside panes, and exposes the current session through the `herdr` CLI.

Before issuing any control command, verify that this agent is running inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
```

If the check fails, say that you are not running inside Herdr and stop. Do not inspect or control the focused Herdr session from outside Herdr.

When the check passes, the `herdr` binary in `PATH` talks to the current session. Use it to inspect neighboring work, create terminal layout, start agents and commands, read output, and wait for state changes.

## Learn the current CLI

The installed binary is the authority for command syntax. Start with:

```bash
herdr --help
```

Then print the relevant command group by running the group without a subcommand:

```bash
herdr agent
herdr pane
herdr workspace
herdr tab
herdr worktree
herdr terminal
herdr notification
herdr integration
herdr plugin
herdr session
```

Do not run bare `herdr` for discovery; it launches or attaches the TUI. Do not probe a mutating nested command by omitting arguments. Commands such as `herdr workspace create` are valid with defaults and will execute.

Most control commands return JSON. Read identifiers and state from those responses instead of predicting them.

## Understand layout, panes, and agents

Choose the primitive that matches the job:

- Workspace, tab, and pane topology organize terminal locations.
- Pane commands control raw terminals, shells, tests, servers, input, and output.
- Agent commands control the recognized coding agent currently occupying a pane.

A pane exists whether or not it contains an agent. `agent start` requires an existing available shell pane and never creates, splits, or moves layout. Use pane commands for ordinary processes. Use agent commands when Herdr must validate agent identity or interpret `idle`, `working`, `blocked`, `done`, and `unknown` lifecycle states.

Agent commands accept either a unique live agent name or the pane ID currently hosting that agent. They do not accept terminal IDs or bare agent-kind labels. Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. A name follows the current pane occupant and is cleared when that agent exits, is released, or is replaced.

`idle` means the agent is ready for input and its tab has been seen in the focused Herdr UI. `done` is the same underlying idle state after unseen background work finishes. Focusing the tab or targeting the pane or agent with a focus command marks it seen. CLI reads do not mark it seen. `blocked` means Herdr recognized an approval or question UI. `unknown` means an agent is present but Herdr cannot classify it confidently; it does not prove completion.

## Use IDs and caller context

Public IDs are opaque stable handles:

- workspace: `w1`
- tab: `w1:t1`
- pane: `w1:p1`

Closed tab and pane IDs are not reused. A pane moved into another workspace receives a new workspace-qualified pane ID. After `pane move`, continue with `.result.move_result.pane.pane_id` or the live agent name. The old value is reported as `.result.move_result.previous_pane_id`; only the moved process's inherited caller context keeps resolving that old ID, so do not use it as a general agent target.

Herdr injects the caller's context into each managed pane:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

Prefer `--current` when a pane command should target the calling pane. Omitting a target may use the UI-focused pane, which can belong to the user or another client.

Discover live state with:

```bash
herdr workspace list
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane current --current
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

Creation responses expose the IDs to use next. `workspace create` returns `.result.workspace`, `.result.tab`, and `.result.root_pane`. `tab create` returns `.result.tab` and `.result.root_pane`. `pane split` returns the new pane as `.result.pane`.

## Start and coordinate an agent

Default to a sibling pane in the current tab and the current working directory. Do not create a workspace, tab, worktree, or different cwd unless the user explicitly requests that topology or location.

Honor a direction requested by the user. Otherwise inspect the caller pane:

```bash
herdr pane layout --pane "$HERDR_PANE_ID"
```

Split a wide pane to the right and a narrow or tall pane down. Avoid repeated same-direction splits that create unusably narrow columns or short rows. Keep the user's focus in the calling pane and explicitly preserve the caller's working directory:

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Replace `right` with `down` when appropriate. Read the new pane ID from `.result.pane.pane_id`.

An available shell pane must be at its interactive prompt, with the shell itself in the foreground and no foreground command, editor, or agent running. Start a supported agent in that pane with a useful unique name:

```bash
herdr agent start reviewer --kind codex --pane <returned-pane-id>
```

Use the kind requested by the user. Run `herdr agent` to inspect the installed kind list and options. Pass native agent arguments only after `--`:

```bash
herdr agent start reviewer --kind codex --pane <returned-pane-id> -- <agent-args...>
```

A successful `agent start` returns only after Herdr detects the expected agent in the same pane and considers it ready for interactive input. If the agent is blocked during startup, the command returns `agent_not_ready` immediately but keeps the name available for `agent read` and `agent send-keys`. Wait until the agent becomes idle before prompting it. Startup defaults to a 30-second timeout.

Submit work through the agent surface:

```bash
herdr agent prompt reviewer "Review the current diff and report only actionable findings." --wait --timeout 120000
```

`agent prompt` honors the pane's live bracketed-paste mode and sends text followed by encoded Enter after a short delay. It rejects an agent already waiting at an approval or question dialog with `agent_blocked` before sending any input. Inspect the blocked UI and ask the user before answering it. For normal agent work, `--wait` is enough: it waits for the first settled `idle`, `done`, or `blocked` state. Do not repeat those defaults with `--until`.

A prompt sent from a non-working state must produce an observed lifecycle change within five seconds. Otherwise Herdr returns `agent_prompt_stalled` instead of waiting indefinitely. This wait tracks lifecycle state, not an individual turn; if the agent is already working, completion of the active turn may satisfy it.

Use `--until` only for a state-specific workflow, such as waiting for an already-running agent to request input:

```bash
herdr agent wait reviewer --until blocked --timeout 120000
```

Without `--until`, standalone `agent wait` uses the same settled-state defaults as `agent prompt --wait`.

Use logical keys for interactive agent UI controls:

```bash
herdr agent send-keys reviewer esc
herdr agent send-keys reviewer ctrl+c
```

Herdr validates all keys before writing any bytes. Read the result through the resolved agent:

```bash
herdr agent get reviewer
herdr agent read reviewer --source recent-unwrapped --lines 120
```

If a wait fails or returns `blocked`, inspect `agent get` and `agent read` before deciding what input to send. Use the pane surface only when raw terminal control is intentional.

## Run an ordinary command in another pane

Create a sibling pane with the same geometry rule, preserve the caller's working directory, and keep user focus unchanged:

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Read the new pane ID from `.result.pane.pane_id`, then run and inspect the command:

```bash
herdr pane run <returned-pane-id> "just test"
herdr pane wait-output <returned-pane-id> --match "test result" --timeout 120000
herdr pane read <returned-pane-id> --source recent-unwrapped --lines 120
```

`pane run` atomically sends command text and Enter. `pane wait-output` searches the selected snapshot immediately, so output that already exists can match. Use `--match <text>` for a literal substring or `--regex <pattern>` for a Rust regular expression. Omitting `--timeout` allows an indefinite wait.

Use the read source that matches the task:

- `visible`: the currently rendered viewport.
- `recent`: recent rendered output, including soft wraps.
- `recent-unwrapped`: recent output with soft wraps joined; prefer it for logs and transcripts.
- `detection`: the plain-text bottom-buffer snapshot used for agent detection.

Use `--format ansi` when colors and terminal styling are evidence. Otherwise use text.

`--lines` asks Herdr for more rows from the pane's available screen and host scrollback. If increasing it does not reveal more of a completed response, the pane is probably running the agent on the terminal's alternate screen. Rows that leave the alternate screen do not enter Herdr's host scrollback, so a larger line count cannot recover them.

After that failed read, ask the agent to write its complete response as Markdown in a temporary directory and reply only with the file path, then read the file directly. Use this only as a fallback; do not request file output in the initial prompt.

## Herdr Browser 插件（浏览器 pane）

Herdr Browser 插件在 herdr pane 里渲染真实 Chromium 视图：agent 经 CLI 驱动，用户可鼠标键盘直接接管。本机已安装（官方插件，`herdr plugin list --plugin official.browser --json` 确认 `enabled: true`）。

### 前置条件（本机已配置，勿动）

- `~/.config/herdr/config.toml` 必须有 `[experimental] kitty_graphics = true`
- 依赖 bun + Google Chrome（本机已具备）

### 打开浏览器 pane（唯一正确方式）

```bash
herdr plugin pane open --plugin official.browser --entrypoint browser \
  --placement split --direction right \
  --env HERDR_BROWSER_INITIAL_URL=https://example.com --focus
```

- `--placement`：`split` / `tab` / `zoomed` / `overlay`
- `--env HERDR_BROWSER_INITIAL_URL=...` 可选，启动即导航到该 URL
- ⚠️ **禁止**用 `herdr pane split` + `herdr pane run <pane> "bun run src/viewer.ts"` 手动启动：不走插件机制时图形流不会建立（metrics 中 `graphics_stream.active: false`、`frames: 0`），用户看不到图像、顶栏卡在 about:blank。已实测踩坑。

### agent 驱动 CLI

插件不装全局命令，在插件根目录用 bun 运行（根目录：`~/.config/herdr/plugins/github/official.browser-ff2a44eccae9`，可用 `herdr plugin list --plugin official.browser --json` 查 `plugin_root`）：

```bash
BROWSER=~/.config/herdr/plugins/github/official.browser-ff2a44eccae9
bun run $BROWSER/src/cli.ts open https://example.com    # 导航（等待加载完成，返回标题）
bun run $BROWSER/src/cli.ts text                        # 读页面可见文字
bun run $BROWSER/src/cli.ts eval '<js>'                 # 执行 JS 表达式，返回 JSON（DOM 检查/点击）
bun run $BROWSER/src/cli.ts type <selector> <text>      # 填表单
bun run $BROWSER/src/cli.ts click <x> <y>               # 坐标点击
bun run $BROWSER/src/cli.ts selector-click <selector>   # 按 CSS 选择器点击
bun run $BROWSER/src/cli.ts wait '<js>' [timeoutMs]
bun run $BROWSER/src/cli.ts screenshot --output /tmp/x.png
bun run $BROWSER/src/cli.ts views | tabs | switch-tab <id>
bun run $BROWSER/src/cli.ts metrics                     # 诊断：graphics_stream.active 应为 true
bun run $BROWSER/src/cli.ts status | stop
```

daemon 由插件自动管理（state：`~/.local/state/herdr/plugins/official.browser/daemon.json`），无需手动 override 环境变量；`stop` 后下次打开自动重启。

### 登录/表单自动化流程（实测）

1. `open <url>` 导航
2. `eval` 找入口——按钮常是图标按钮，按 aria-label/title 匹配：
   `[...document.querySelectorAll("button")].map(b => ({label: b.getAttribute("aria-label"), text: (b.textContent||"").trim()}))`
3. 无 selector 可点的按钮直接在 eval 里 `el.click()`
4. `type <selector> <text>` 填用户名/密码，eval 或 `selector-click` 提交
5. `text` / `eval` 验证登录态（菜单出现"退出登录"、页面显示账号即成功）

### 排障

- 用户看不到图像 → `metrics` 查 `graphics_stream.active`；为 false 说明启动方式错误或 kitty_graphics 未开
- 顶栏 URL 卡住不更新 → viewer 未正确初始化，重开插件 pane
- 页面内容用 `text` / `eval` 读，不要用 `pane read`（图形帧不进终端文本缓冲）
- 浏览器 pane 是交互程序：`pane run` 发文本会被它当作键盘输入吞掉，不要往浏览器 pane 发命令

## Safety and coordination rules

- Use `--no-focus` for background work unless the user asked to switch context.
- Use `--current`, an explicit pane ID, or a unique agent name. Do not rely on another client's focused pane.
- Parse IDs from JSON responses. Do not derive them from sidebar order or examples.
- Do not close workspaces, tabs, panes, or sessions you did not create unless the user explicitly asked.
- Never run `herdr server stop` from an active session unless the user explicitly intends to stop the server and its pane processes.
- Never kill the main Herdr process. Use named test sessions for experiments that need an isolated server.
- CLI server errors are JSON on stderr with exit status 1. CLI syntax errors exit with status 2.

## 多 panel 编排实战（2026-08-10 实测）

多顾问并行场景：一个 pane 跑 omp 主会话，右侧 pane 跑 kimi code yolo，下方 pane 跑 agy，三个 agent 收同一份提示词。完整流程：

1. **退出 pane 内已有 omp 会话**：`herdr pane send-keys <pane> ctrl+d`（EOF 直接退 TUI 回 shell；会话可 `omp --resume <id>` 恢复，退出前 read visible 记下 resume id）。
2. **kimi code yolo**：`herdr agent start <name> --kind kimi --pane <pane-id> -- -y`（`-y` = yolo 自动批准工具调用）。交互细节见 `references/kimi-code-interaction.md`。
3. **agy CLI**：`herdr agent start <name> --kind agy --pane <pane-id> -- --dangerously-skip-permissions`。首次启动可能卡账号资格验证（"Verifying your account... please try again shortly"）——ctrl+c 两次退出后重启即过；验证横幅期间 prompt 会静默丢失。见 `references/agy-interaction.md`。
4. **第三 pane 布局**：`herdr pane split --pane <id> --direction down --no-focus`（split 只支持 right/down；无 tab 级分栏）。**先建好布局再发 prompt**——运行中 split 会 resize 已有 agent 的 TUI。
5. **共享提示词**：写一份 prompt 文件（`local://advice-prompt.md`），`herdr agent prompt <name> "$(cat <绝对路径>)" --wait` 后**无条件补 `send-keys <name> enter`**（kimi 必须；agy 无害）。
6. **收尾取全文**：`agent get` 看状态、`agent read --source recent-unwrapped` 取回复。⚠️ kimi code 长输出（尤其 swarm 子代理模式）在 alternate screen，`recent-unwrapped` 只能拿到可见部分（出现 `ctrl+o to expand` 提示）——分多段 `--lines` 读或让它把完整回复写文件。
7. **退出 agent（2026-08-10 实测三种方式）**：
   - omp：`pane send-keys <pane> ctrl+d`（EOF 直退，会话 `omp --resume <id>` 恢复）
   - kimi code：ctrl+d **无效**，用 `pane send-text <pane> /exit` + `enter`；退出时界面提示 `kimi -r session_<id>` 恢复命令，先 read visible 记下
   - agy：`agent send-keys ctrl+c` **两次**（第一次进 "press ctrl+c again to exit" 确认态，第二次退出）；重启要在 pane 回 shell（`❯`）后进行，否则 `agent start` 报 exit 5
8. **关闭 panel**：`herdr pane close <pane-id>`（agent 已退出后直接关；未退时先按第 7 条退出）。清场顺序：退出 agents → close panes → 主 omp 最后 Ctrl+D。
9. **多轮复用**：agent pane 保持运行，多轮 `prompt + send-keys enter` 复用同一会话（上下文累积，kimi 实测 20%→35%），无需重启。每轮 `prompt --wait` 在 12-15s 超时返回 timeout 错误是**正常现象**（文本已发出，补 enter 即提交），不是失败。
10. **等待时长预期**（`agent wait --timeout 300000`）：agy（Gemini Flash）5-20s 完成；kimi code 90-280s（swarm 模式更久）；后台 task 型顾问（老刀/Kimi）1-4 分钟——多路并行时先等快的收结果，慢的用 `agent wait` 阻塞。

## References

- `references/kimi-code-interaction.md` — kimi code 交互实战：`agent prompt` 反复 `agent_prompt_stalled`（paste 后 Enter 不提交）的根因与修复流程（prompt 后补 `send-keys enter`）。与 kimi kind 交互前必读。
- `references/agy-interaction.md` — agy（Antigravity CLI）交互实战：账号资格验证卡死与重启修复、prompt 流程、`--dangerously-skip-permissions`、发送通道陷阱（`pane run` 勿用于 TUI）。与 agy kind 交互前必读。
- `references/mcp-config.md` — MCP 项目级配置实战（2026-08-16）：agy 用 `.agents/mcp_config.json`（`serverUrl`），kimi code 用 `.kimi-code/mcp.json`（`url`），beaver-zotero 实例、重启生效、`/mcp` 与 `kimi -p` 验证法。给 pane 内 agent 装 MCP 前必读。

