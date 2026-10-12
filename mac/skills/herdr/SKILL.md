---
name: herdr
description: "Control Herdr, a terminal multiplexer for coding agents. Use only when the user explicitly mentions Herdr or asks to use Herdr to inspect or control panes, tabs, workspaces, commands, or another agent. Do not use merely because a task could benefit from a background terminal, delegation, or parallel work. Requires HERDR_ENV=1."
disable-model-invocation: true
---

> **真源**：`~/Documents/github/dotfiles/mac/skills/herdr`（install.sh 自动 symlink 到 `~/.pi/agent/skills/herdr` 与 agy 全局位）。
> **本文件只做导航**（2026-10-12 瘦身）：原官方正文 226 行已移出——它是 `herdr --skill` 的**快照**，留在库里只会随上游漂移。

## 三处真源

| 要什么 | 去哪 |
|---|---|
| **CLI 命令语义（权威）** | 跑 `herdr --skill` 现取；或直接打命令组看子命令：`herdr agent` / `pane` / `tab` / `workspace` / `terminal` / `worktree` / `notification` / `integration` / `session` |
| **本机实战经验** | 同目录 `references/`：`agent-dispatch.md`（派发·状态语义·轮询与踩坑）· `pi-interaction.md`（跑 pi）· `agy-interaction.md`（跑 agy）· `mcp-config.md`（MCP 配置） |
| **派发 / 回收 worker（多 agent）** | 用 **`herdr-dispatch`** skill（已装全局：job store + generation 对账 + 交付物读取 + 有界 watch）；**不要再手写 `herdr agent start/wait/prompt` 序列** |

## 三条不可忘

1. 先验 `test "${HERDR_ENV:-}" = 1`；不成立就说「不在 Herdr 里」并停手——**不要从外面操控会话**。
2. **不要跑裸 `herdr`**（会 attach TUI 卡住）；命令组可以直接打（`herdr pane` 等）。
3. `pane split` 必须带 `--cwd <目标> --no-focus`；给 worker 用**显式 pane id**，不要 `--current`。
