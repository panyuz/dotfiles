# Paseo Chat 是否运行在 pi 上，是否遵守项目指令

调研日期：2026-10-16（CST）
本机：macOS；Paseo Desktop / daemon 0.11.4；pi 1.3.0；项目 `/Users/panyu/Documents/github/INVEST`
调研方式：只读。读代码、读会话文件、读进程信息、跑官方只读诊断。不改配置，不安装。

---

## 1. 结论

**要点 1。** Paseo 的 Chat 不是自带的对话引擎。Chat 是「工作区启动目标」的一种（另一种是终端）。
你为这个 Chat 选一个 provider。Paseo 用子进程启动那个 provider 的 CLI。

**要点 2。** 只有当 Chat 的 provider 选 pi 时，Chat 才运行在 pi 上。
本机已确认这种 Chat 存在，而且 pi 是同一个 pi 1.3.0 二进制。

**要点 3。** 这种 Chat 遵守项目指令。
pi 以 `--mode rpc` 子进程方式启动。它的 cwd 是工作区目录。
所以它走完整规则链：全局 `AGENTS.md`、项目 `AGENTS.md`、skills、extensions、`.pi/mcp.json`。
规则加载由 pi 完成，Paseo 不替换规则。

**要点 4。** 三种情况必须分开看。

| 情况 | 是否运行 pi | 是否读本项目 AGENTS.md |
|---|---|---|
| Paseo Chat，provider 选别的（claude / codex / copilot / opencode / antigravity / muse） | 否。跑各自的 CLI | 否。它们有自己的规则文件 |
| Paseo Chat，provider 选 pi | 是。`pi --mode rpc` 子进程 | 是。见 §3 |
| Paseo 终端里手动敲 `pi` | 是。默认 TUI 模式 | 是。同一条规则链 |

所以不能说「所有 Paseo Chat 都是 pi」。

**要点 5。** 本机不需要改动。Chat 已经加载规则链。见 §7。

---

## 2. Paseo 端的证据：pi provider 如何启动

代码位置在应用包内：`/Applications/Paseo.app/Contents/Resources/app.asar`。
内部路径前缀 `node_modules/@getpaseo/server/dist/server/server/agent/providers/pi/`。

| 事实 | 证据 |
|---|---|
| 启动方式是子进程 + JSONL RPC，不是 SDK，也不是内嵌 | `providers/pi/cli-runtime.js`：`new JsonlRpcProcess(...)`，`spawn(launch)` |
| 命令是 `pi --mode rpc` | `providers/pi/runtime.js`：`appendPiLaunchArgs` 先压入 `--mode`，默认值 `"rpc"` |
| cwd 是工作区目录 | `runtime.js`：`return { cwd: input.session.cwd, argv, ... }` |
| 只传这些参数：`--mode`、`--model`、`--thinking`、`--session` 或 `--no-session`、`--mcp-config`、`--extension` | 同上 `appendPiLaunchArgs`。没有 `--system-prompt`，也没有 `--approve` |
| 会话默认持久化 | `agent.js`：`noSession: config.internal === true`。普通 Chat 的 `internal` 不是 true。会话文件已落盘（见 §3） |
| 环境变量来自 daemon | `paseo-env.js`：`createExternalProcessEnv` 复制 daemon 环境，只删 Paseo 自己的运行控制键 |
| Paseo 会追加一个自己的扩展 | `agent.js`：`createPiPaseoExtensionFile` 在 `/tmp/paseo-pi-extension-*/paseo-integration.mjs` 生成扩展，并用 `--extension` 传入 |
| 该扩展默认不改系统提示词 | 该扩展只在 `systemPrompt` 非空时挂钩 `before_agent_start`。空值来自 `daemon.appendSystemPrompt`，本机 `~/.paseo/config.json` 没有这一项 |
| pi 没有可选 mode | `agent.js`：`setMode` 抛错 `"Pi does not expose selectable modes"`；`modes: []`。Chat 记录里 `lastModeId` 是 null |
| MCP 注入方式会探测 pi 版本 | `agent.js`：`detectMcpSupport` 起一个探针 pi 进程，调用 `get_commands`。pi 1.3.0 命中内建 MCP（`sourceInfo.path === "builtin:mcp"`） |

外部文档印证（Paseo 官方）：

- `https://paseo.sh/docs/providers.md`：「The actual binary lives on your machine and runs as a normal subprocess.」
- 同一页：「Your subscriptions, config, skills, and MCP servers stay intact.」
- `https://paseo.sh/docs/supported-providers.md`：Pi 属于 native support，装好 CLI 就能用。
- `https://paseo.sh/docs/workspaces.md`：「Paseo is organized around workspaces, not chats.」

**「Chat」这个词的来源。** 桌面端新建工作区时，启动目标分 `chat` 和终端两类。
证据在桌面端 bundle：`app-dist/_expo/static/js/web/index-*.js` 中出现
`"chat"===S.kind ? O("newWorkspace.launch.chat") : O("newWorkspace.launch.terminal")`
与 `new-workspace-launch-option-chat`。
所以「Chat」= 一个 agent 对话面板，不是另一个引擎。

---

## 3. 实测：Chat 会话实际注入了哪些规则

pi 会把每次请求的完整提示词分节写进会话文件。
文档：`docs/session-format.md`（`pi` 安装目录内），「the first request of a session persists one with every prompt section」。

**样本 A（Chat，provider=pi，已结束）**

- agent 记录：`~/.paseo/agents/Users-panyu-Documents-github-INVEST/101f043e-1123-4ff3-808c-3bdc7c1963fe.json`
- `provider: "pi"`，`cwd: /Users/panyu/Documents/github/INVEST`，创建于 2026-10-16T08:36Z
- `persistence.nativeHandle` 指向真实 pi 会话文件：
  `~/.pi/agent/sessions/--Users-panyu-Documents-github-INVEST--/2026-10-16T08-36-07-604Z_01a143da-af33-7369-994d-a31289aa2656.jsonl`

**样本 B（Chat，provider=pi，调研中）**

- `~/.paseo/agents/.../b5f50683-2739-4cde-8e89-a5916c3a8864.json`，标题「pi 适配 Paseo：最小改动调研」，创建于 2026-10-16T09:59Z
- 会话文件：`.../2026-10-16T09-59-37-859Z_01a14427-227f-73e3-9123-4f3e5ec98985.jsonl`

**两个样本的首条 system 消息都有 8 个分节：**
`preamble`、`tools`、`rules`、`docs`、`project_context`、`skills`、`cwd`、`mcp_servers`。
这与本机终端 pi 会话的分节完全一致。

**分节内容核对（样本 B）：**

| 规则层 | 实际注入内容 | 状态 |
|---|---|---|
| 全局指令 | `project_context` 内含 `<project_instructions path="/Users/panyu/.pi/agent/AGENTS.md">` | 已注入 |
| 项目指令 | 同一节内含 `<project_instructions path="/Users/panyu/Documents/github/INVEST/AGENTS.md">` | 已注入 |
| 全局 skills | `~/.pi/agent/skills/dotfiles`、`herdr-dispatch`、`herdr-swarm` | 已注入 |
| Agent Skills 目录 | `~/.agents/skills/paseo`、`paseo-advisor`、`paseo-committee`、`paseo-handoff`、`paseo-help`、`paseo-plugin` | 已注入 |
| 项目 skills | `/Users/panyu/Documents/github/INVEST/.pi/skills/answer-me-with-html` | 已注入 |
| 项目 extensions | `tools` 列表含 `ask_advisor`、`jev_pick_tool`、`ask_user_question` | 已注入 |
| 项目 MCP | `mcp_servers` 节含 `mcp__invest_duckdb` 等 9 个服务 | 已注入 |
| cwd | `/Users/panyu/Documents/github/INVEST` | 已注入 |

**对照实验（证明「读到了文件」≠「已注入」）。**

样本 A 创建于 08:36Z。它的全局 `AGENTS.md` 快照含旧章节 `herdr (terminal multi-agent parallel)`。
当前磁盘上的全局 `AGENTS.md` 已换成新章节 `Paseo（本机 agent 协作）`（该文件是软链接，
指向 `dotfiles/mac/pi/agent/AGENTS.md`）。
样本 B 创建于 09:59Z，它的快照含新章节 `Paseo（本机 agent 协作）`，不含旧 herdr 章节。

结论：会话文件里的文字是「启动时真正注入的提示词快照」，不是事后重读磁盘。
样本 A 也说明：旧会话保留旧规则，改规则后要新开 Chat 才生效。

**进程层证据：**

- `ps`：4 个 `pi` 进程的父进程是 `Paseo Daemon`（pid 15231）。
- `lsof`：这些 pi 进程的 cwd 都是 `/Users/panyu/Documents/github/INVEST`。
- `~/.paseo/daemon.log`：`"daemonVersion":"0.11.4"`，并含
  `Creating agent in /Users/panyu/Documents/github/INVEST (pi)`。
- 官方只读诊断 `paseo provider diagnostic pi --json` 返回：
  `Resolved path: /Users/panyu/.local/bin/pi`、`Version: 1.3.0`、
  `Auth config (~/.pi/agent/auth.json): found`、`Models: 165`、`Status: Ready`。
- `~/.local/bin/pi` 是指向 `~/.pi/agent/bin/pi`（版本管理启动器）的软链接。
  终端里 `which pi` 命中同一个文件。所以 Chat 与终端用同一个 pi。

**未加载的文件（本机不存在，故无内容可加载）：**

- `~/.pi/agent/APPEND_SYSTEM.md`、`~/.pi/agent/SYSTEM.md`
- `/Users/panyu/Documents/github/INVEST/.pi/APPEND_SYSTEM.md`、`.../.pi/SYSTEM.md`

**trust 状态：** `~/.pi/agent/trust.json` 中 `/Users/panyu/Documents/github/INVEST` 为 `true`。
项目 `.pi/mcp.json` 与 `.pi/extensions` 能加载，正是这个记录生效的结果。

---

## 4. Chat 与终端 CLI 的差别

| 项目 | Paseo Chat（provider=pi） | Paseo 终端手动跑 pi |
|---|---|---|
| 进程归属 | pi 是 Paseo Daemon 的子进程 | pi 是你的 shell 的子进程 |
| 启动参数 | `pi --mode rpc`，参数由 Paseo 决定 | 你的参数，默认 TUI |
| 界面 | 无 TUI。事件流到 Paseo 面板 | 完整 TUI |
| TUI 功能 | 不可用：快捷键、主题、状态栏、`/scoped-models` 等交互命令 | 可用 |
| 扩展 UI | 请求转发给 Paseo 客户端 | 直接显示在终端 |
| 规则链 | 相同（见 §3） | 相同 |
| 模型 / 思考级别 | Paseo 面板设置，写入会话 metadata | `--model` / `--thinking` 或 TUI |
| 会话文件 | 同一目录 `~/.pi/agent/sessions/` | 同一目录 |
| 额外扩展 | 多一个 Paseo 生成的桥接扩展（`--extension`） | 无 |
| Paseo 自有 MCP 工具 | 默认不注入（`daemon.mcp.injectIntoAgents` 默认 false） | 不适用 |
| PATH | daemon 的 PATH | shell 的 PATH |
| 信任提示 | 不能弹窗（RPC 模式） | 可以弹窗 |

**PATH 实测差异：**

- daemon PATH：`~/.local/bin`、`~/.bun/bin`、`/opt/homebrew/bin`、`/pkg/env/global/bin` 等。
- 终端 PATH 多两项：`/Users/panyu/.pi/agent/bin` 与 `/Applications/Paseo.app/Contents/Resources/bin`。
- 影响：Chat 里 `pi` 仍可解析（`~/.local/bin/pi`）。但 `paseo` 命令不在 Chat 的 PATH 上。
  样本 A 的 agent 自己执行了 `export PATH="/Applications/Paseo.app/Contents/Resources/bin:..."` 才能跑 `paseo`。
- 这两项的来源未核实（[未核实]）。

**项目扩展命令可用 ≠ 全部 TUI 命令可用。**
Paseo 会通过 `get_commands` 拉取命令列表（`providers/pi/cli-runtime.js` 的 `getCommands`）。
所以扩展注册的命令能被 Chat 看到。但 RPC 模式没有 TUI 层，交互式 TUI 命令仍不可用。

---

## 5. 适用条件

1. 该 Chat 的 provider 必须是 pi。选别的 provider，本报告的规则链结论不成立。
2. 工作区 cwd 决定加载哪一组 `AGENTS.md`。换到 worktree 或别的目录，加载集合会变。
3. daemon 的 PATH 必须能解析 `pi`。本机满足，且解析到 1.3.0。
4. 项目 trust 必须已有记录。RPC 模式不能弹窗。
   若某目录没有 trust 记录，且 `defaultProjectTrust` 是默认 `"ask"`，
   pi 会静默跳过受保护的项目资源（`.pi/settings.json`、`.pi/mcp.json`、`.pi/extensions`、
   `.pi/skills`、`.pi/APPEND_SYSTEM.md` 等）。
   依据：pi 文档 `docs/security.md`「Project trust without an interactive prompt」。
5. `AGENTS.md` / `CLAUDE.md` 这类 context 文件不受 trust 限制，始终加载。
6. 旧 Chat 保留旧规则快照。改规则后要新开 Chat。

---

## 6. 限制与未证实项

1. 未在 RPC 模式下实跑一次 pi 去观察提示词。证据来自会话文件与代码。这样避免产生额外会话与费用。
2. trust 在 RPC 下的静默跳过行为来自官方文档，未做实验验证。
3. Paseo 生成的桥接扩展与项目扩展之间的加载顺序、冲突处理未测。
   只确认两者都出现在已加载工具列表里。
4. `daemon.appendSystemPrompt` 设为非空时的追加效果未测。当前配置为空，所以没有追加。
5. `daemon.mcp.injectIntoAgents` 设为 true 时，Chat 内会出现哪些 Paseo 工具，未测。
6. 终端 PATH 中那两项的注入来源未核实（[未核实]）。
7. 桌面端 bundle 是压缩代码，字符串引用来自 grep，未做运行期断点确认。
8. Paseo 的 pi provider 代码里有 OMP（Oh My Pi）兼容注释。
   本机已停用 OMP，对 pi 路径没有观察到影响。

---

## 7. 是否需要改动

**不需要改动。**

理由：

1. Chat（provider=pi）已经加载全局与项目 `AGENTS.md`、skills、extensions、项目 MCP。
2. 规则加载由 pi 完成。Paseo 不替换规则，也不清空规则。
3. 因此不必为「让 Chat 读到规则」而改配置，也不必停用任何 pi 扩展或 skill。

**可选、非必需**（仅当你有别的目标）：

- 想在 Chat 里用 Paseo 自己的编排工具：设 `daemon.mcp.injectIntoAgents`。这是加工具，不是加规则。
- 想让每个 Chat 都带一句 Paseo 提示：设 `daemon.appendSystemPrompt`。

**建议保留观察项：**

- 新建项目目录后，先在该目录跑一次交互式 pi 并做 `/trust`，再让 Chat 使用。
- 记住 `paseo` 命令不在 Chat 的 PATH 上。需要时用绝对路径。

---

## 8. 引用清单

本机文件：

- `/Applications/Paseo.app/Contents/Resources/app.asar`
  → `node_modules/@getpaseo/server/dist/server/server/agent/providers/pi/{runtime,cli-runtime,agent}.js`
  → `.../server/server/agent/{system-prompt,create-agent-mode,paseo-tool-policy,config}.js`
  → `.../server/server/paseo-env.js`
- `/Applications/Paseo.app/Contents/Resources/app-dist/_expo/static/js/web/index-*.js`（桌面端 UI 字符串）
- `/Applications/Paseo.app/Contents/Resources/bin/paseo`（CLI 启动脚本）
- `~/.paseo/config.json`、`~/.paseo/daemon.log`、`~/.paseo/agents/...`
- `~/.pi/agent/AGENTS.md`（软链接）、`~/.pi/agent/trust.json`、`~/.pi/agent/settings.json`
- `~/.pi/agent/sessions/--Users-panyu-Documents-github-INVEST--/*.jsonl`
- pi 文档：`~/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/docs/`
  → `configuration.md`、`security.md`、`session-format.md`、`rpc.md`、`skills.md`、`mcp.md`

外部文档：

- https://paseo.sh/docs/providers.md
- https://paseo.sh/docs/supported-providers.md
- https://paseo.sh/docs/workspaces.md
- https://paseo.sh/docs/custom-providers.md

---

## 9. 变更记录

- 2026-10-16：首次建立。只读调研，无配置改动。
