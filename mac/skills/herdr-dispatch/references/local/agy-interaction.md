# agy（Antigravity CLI）交互实战

本文记在 herdr pane 里跑 agy 的本机口径。命令语义真源是官方 `SKILL.md` 与 `agy --help`。

**版本**：本文的观察来自 agy 1.1.13（2026-08-10 与 08-16 实测）。本机 2026-10-07 已升到 1.3.0，未逐条复测。

## 启动

```bash
herdr agent start <name> --kind agy --pane <pane-id> -- --dangerously-skip-permissions
```

- `--dangerously-skip-permissions` 等于 yolo。它自动批准工具权限请求。
- 本机 agy 在 `~/.local/bin/agy`。账号 smartpanyu@gmail.com（Google AI Pro）。默认模型 Gemini 3.6 Flash (High)。
- 交互提示符是 `>`。按 `?` 看快捷键。

## 先判断就绪，再发 prompt

WARNING：首次启动常卡在账号资格验证。

```
⚠ Verifying your account...
  ⎿  We're finishing verifying your account eligibility.
```

这个状态下输入框是空的，`herdr agent prompt` 的内容不会落地。agent 状态回到 `done`，但没有输出。提示词是静默丢失，不是排队。

就绪的判断：`herdr agent read <name> --source visible` 看不到 `Verifying your account`，并且出现干净的 `>` 提示符。

修复方法是重启一次。

```bash
herdr agent send-keys <name> ctrl+c     # 第一次：进入退出确认态
herdr agent send-keys <name> ctrl+c     # 第二次：真正退出，回到 shell
# 等 pane 回到 shell 提示符。agent start 要求 pane 在交互 shell 提示符
herdr agent start <name> --kind agy --pane <pane-id> -- --dangerously-skip-permissions
```

WARNING：第二次 ctrl+c 后立刻 `agent start` 会失败。pane 还在退出确认态，报 exit code 5。先看 `pane read --source visible` 确认回到提示符。

## 发 prompt

```bash
herdr agent prompt <name> "<任务>" --wait --timeout 20000
herdr agent send-keys <name> enter
herdr agent wait <name> --timeout 300000
herdr agent read <name> --source recent-unwrapped --lines 100
```

- 写作类任务里，`--wait 20s` 超时属正常。补 enter，再用 `agent wait` 等。实测一次写作任务 83 秒完成。
- 回复在 TUI 内渲染。`recent-unwrapped` 能读全文，本次 800 字建议一次拿到，不用写文件兜底。
- 长任务结束后状态是 `done`，含义是回到 idle。

## 发送通道

WARNING：`herdr pane run` 对 TUI 程序不可用。若 pane 前台不是 agent（agy 已退出、shell 在提示符），`pane run` 会把整段 prompt 当 shell 命令**逐行执行**，刷满 `command not found`，且无法回滚。发 prompt 前先确认 pane 前台是 agent。

| 情况 | 通道 |
|---|---|
| agent 已由 `herdr agent start` 托管 | `herdr agent prompt`，再补 enter |
| agent 没托管 | `herdr pane send-text <pane> "<文本>"`，再 `pane send-keys <pane> enter` |

WARNING：`herdr agent send-keys` 只接逻辑按键（esc、ctrl+c、enter）。传 `"/mcp"` 这类文本会报 `invalid_key`。发斜杠命令要用 `send-text`。

## 会话

- 恢复：`--continue`（最近一次）或 `--conversation <id>`。
- 单发：`-p` 或 `--print`。
- 未验证：`--model` 切换、`--sandbox`、`agent` 子命令列表。需要时查 `agy --help`。

## MCP

配置方法、字段与坑见同目录 `mcp-config.md`。要点两条：项目级 MCP 走插件；配置改动后必须重启会话。

## 观察

- 读文件会显示 `● Read(/abs/path)` 步骤行。实测 8 个文件并行读，约 5 秒。
- MCP 调用显示为 `● beaver-zotero/search_by_metadata(...)` 步骤行。用它核查 agent 是否真用了 MCP。
- 任务要求「不读某些文件」时，看 Read 步骤行就能验证遵守情况。
- 2026-08-16 的写作任务记录：读 2 个必读材料、beaver-zotero 检索 11 次、WebSearch 3 次、写作加自检，共 83 秒。
