# Herdr 与 Paseo 比较（调研报告）

- 日期：2026-10-16 18:04 CST（本机 `date`）
- 范围：只做只读调研。未改配置、未安装软件、未重启服务、未建 worktree、未派发 agent。
- 本机版本：Paseo Desktop 0.11.4（daemon 由 Desktop 管理，`listen=127.0.0.1:6767`，relay 已启用）；Herdr 0.9.5（client/server protocol 22，server 当前仍在运行）；pi 1.3.0。
- 证据标注：`【官方】`= 官方文档；`【本机】`= 本机实测或源码读取；`【未核实】`= 待验证。
- 边界：dotfiles 里 `mac/paseo/`（POLICY.md、config.json、deploy.sh、backup/、skills/）是未提交草稿。本报告只读取，不执行、不回滚、不当作定稿。安防细节由另一 worker 负责，本报告不重复完整审计。

## 1. 结论摘要

1. 两个工具定位不同。Herdr 是终端工作区管理器（TUI + 本机 server + socket API）。Paseo 是 daemon + 多端客户端的 agent 开发环境。【官方】
2. pi 有两种用法，差别很大：
   - **Paseo 终端里直接跑 pi** = 真 PTY 里跑 pi 原版 TUI。Paseo 只做终端显示与命令边界标记。pi 的一切照旧。
   - **Paseo Chat 里选 pi** = Paseo 用 `pi --mode rpc` 启动 pi 子进程，自己画界面（聊天、时间线、权限弹窗、模型/思考切换、用量）。pi 的 TUI 不出现。【本机·源码】
3. 两种用法共用同一套项目规则与资源。原因是两者都以 workspace 目录为 cwd 启动真实 pi，所以 `AGENTS.md`、skills、extensions、MCP 配置都照常加载。Chat 另加一个临时 extension、一个临时 MCP 配置文件和一段追加 systemPrompt。【本机·源码】
4. 对当前场景（只用 pi 与 Antigravity、不要 worktree、最小改动）：Paseo Chat 覆盖远程/手机/多 agent 协作；Herdr 的唯一不可替代项是"多 pane 终端 + 终端内 agent 生命周期追踪"。若只用单终端跑 pi，Herdr 的增益有限。
5. 未发现 Paseo 会改动 pi 的配置。Paseo 的终端活动 hook 只安装 claude/codex/opencode，不装 pi。【本机·源码】这一点支持最小迁移。
6. 遗留项：Herdr 的 pi integration 文件（`~/.pi/agent/extensions/herdr-agent-state.ts`，v9）仍在 pi 扩展目录，两种模式下都会被 pi 加载。它要求 `HERDR_ENV=1`，在 Paseo 下空转。【本机】`HERDR_ENV` 在本会话未设置。

## 2. 对照总表

| 维度 | Herdr 0.9.5 | Paseo 0.11.4 |
|---|---|---|
| 形态 | TUI 终端复用器 + 本机 server + socket API | daemon + Desktop/iOS/Android/web/CLI/SDK 客户端 |
| 终端管理 | 工作区/标签/窗格，pane 为 PTY；前缀键、缩放、移动、邻居查询【本机】`herdr pane` | 真 PTY（node-pty）+ zsh OSC 633 命令标记；终端是 workspace 里的一个 tab【本机·源码】【官方】 |
| 交互式 pi | 原生：在任何 pane 里直接开 pi TUI | 原生：在终端 tab 里跑 `pi`，TUI 完整 |
| pi Chat/RPC | 无此概念。`herdr agent prompt` 是往 pane 打字 | 有：`pi --mode rpc` 子进程 + Paseo 界面【本机·源码】 |
| agent 生命周期识别 | 有：idle/working/blocked/done/unknown；需 pi integration 上报【官方·skill】 | Chat 模式天然有结构化状态；终端模式靠 hooks，且不含 pi【本机·源码】 |
| 派发子 agent | `herdr agent start <name> --kind pi --pane ID` + `agent prompt --wait`；需先有 shell pane【官方·skill】 | MCP 工具 `create_agent` / CLI `paseo run --no-wait`；子 agent 归属父 agent【官方】 |
| 结果回传 | 读渲染文本：`agent read --lines N`；或 `pane wait-output --match`【官方·skill】 | 通知回注（notifyOnFinish）+ `paseo logs/attach` + Subagents track + 手机查看【官方】 |
| 会话恢复 | 命名持久会话（`herdr session`）+ session-snapshots；agent 名随 pane 内容，退出即清名【本机】 | agent 元数据持久化，记录 pi 原生 session jsonl 句柄，可 resume；可导入既有 pi CLI 会话【本机·源码】 |
| 桌面/手机 | 无原生 app。远程靠 `--remote ssh://` 或 `machine add`（会在远端准备安装并启动 server）【本机】 | 原生 mac/win/linux + iOS/Android + web UI；SSH transport 不在远端安装任何东西【官方】 |
| 远程传输 | SSH、socket 转发 | relay（E2E 加密）、SSH、Tailscale、Docker、自托管 web UI【官方】 |
| 配置 | `~/.config/herdr/config.toml`（本机已软链到 dotfiles）+ 日志/快照/会话 | `~/.paseo/config.json` + `daemon-keypair.json` + `local-credential` + `projects/` + `agents/`【本机】 |
| 对 pi 配置的改动 | 安装/更新 pi integration 文件（Herdr 托管，会覆盖）【本机】 | 不装 pi 终端 hook；Chat 只用命令行参数加临时文件，不写 pi 配置【本机·源码】 |
| 安装来源 | Homebrew/自带 | 原生 app（含 daemon）、npm CLI、Docker【官方】 |

## 3. 关键机制：终端里跑 pi 与 Chat 里选 pi 的差别

这是本次调研最需要说清的一点。

### 3.1 Paseo 终端里直接跑 pi

- Paseo 用 node-pty 开真 PTY，起登录 shell（zsh）。你输入 `pi` 就是原版 pi 进程。【本机·源码】
- Paseo 注入 zsh 集成（`~/.paseo` 内的 `paseo-integration.zsh`，通过 `ZDOTDIR` 方式加载）。它发 OSC 633 标记：命令开始/结束、退出码、窗口标题。【本机·源码】
- 结果：Paseo 只把终端像素流送到客户端。它知道"这条命令跑了、退出码是多少"，不知道 pi 的会话、工具调用或 token 用量。【本机·源码】
- `HERDR_ENV` 不设置，所以 Herdr 的 pi integration 空转。Paseo 也不给 pi 装它自己的 hook（hook 只覆盖 claude/codex/opencode）。结论：这个 pi 不会被 Paseo 当作"agent"追踪。【本机·源码】

### 3.2 Paseo Chat 里选 pi

实际命令行（源码 `buildPiLaunch` + `appendPiLaunchArgs`）：

```text
pi --mode rpc [--model X] [--thinking Y] [--session <jsonl>|--no-session]
   [--mcp-config /tmp/paseo-pi-mcp-*/mcp.json]
   [--extension /tmp/paseo-pi-extension-*/paseo-integration.mjs]
```

要点：

1. **无 TTY**。stdin/stdout 走 JSONL 协议（`spawn` + `stdio: [pipe,pipe,pipe]`），不是 PTY。pi 的 TUI 不启动。【本机·源码】
2. **Paseo 画界面**。聊天时间线、工具调用卡片、模型/思考级别选择、上下文与费用、会话恢复、steering（运行中追加指令）、compact 都由 Paseo 客户端提供。Paseo 用 `get_session_stats` 轮询用量。【本机·源码】
3. **注入一个临时 extension**。文件 `paseo-integration.mjs` 做三件事：
   - `pi.registerMcpServer(...)` 注册 Paseo 自带的 MCP 工具（若该项已开启）；
   - 在 `before_agent_start` 时把 Paseo 的 systemPrompt 追加到 pi 的 systemPrompt；
   - 注册内部命令，供 Paseo 读会话树、做 rewind。
   【本机·源码】
4. **注入临时 MCP 配置**。Paseo 读你真实的 `~/.pi/agent/mcp.json`（或 `mcp-servers` 键），合并 Paseo 的 server 后写入临时文件，再用 `--mcp-config` 传入。你的全局 MCP 配置仍然生效。【本机·源码】
5. **权限与提问仍会到用户**。pi 的扩展权限系统在非 TUI 环境用单选提示（官方说明）；Paseo 通过 `extension_ui_request` / `extension_ui_response` 呈现并回传决定（源码里有 `permission_requested` 与 `resolvePermission`）。所以"要不要允许"会弹在 Paseo 客户端，而不是终端里。【本机·源码 + 官方·pi rpc-extension-ui】
6. **TUI 专属能力退化**。pi 官方列出 RPC 下无效或降级的接口：`custom()`、`onTerminalInput()`、`setFooter/setHeader/setStatus/setWidget`、主题切换、编辑器组件等。本机受影响的已知一处：`turn-timer.ts` 用 `ui.setStatus`。它在 Chat 下能否显示，未核实。【官方 + 本机】

### 3.3 两种用法的共同点

| 项目 | 终端里跑 pi | Chat 里选 pi |
|---|---|---|
| 二进制 | 同一个 `pi` | 同一个 `pi` |
| cwd | workspace 目录 | workspace 目录 |
| 项目/全局 `AGENTS.md` | 加载 | 加载 |
| skills、prompt templates | 加载 | 加载 |
| 你的 extensions（含权限系统、安装守卫） | 加载 | 加载 |
| `~/.pi/agent/mcp.json` | 直接使用 | 读取后合并进临时文件 |
| pi 的 session jsonl | 写入 `~/.pi/agent/sessions/` | 写入同一目录（可互相 resume） |
| 附加 systemPrompt | 无 | 有（Paseo 追加） |
| Paseo 的 MCP 工具 | 无 | 有（开启注入时） |

因此：**规则一致，界面与控制面不同**。

## 4. 逐维度说明

### 4.1 终端管理与交互式 TUI

- Herdr 的强项是终端布局本身：窗格切分、移动、交换、缩放、按方向找邻居、读屏（visible/recent/recent-unwrapped）、按正则等输出。适合"我要同时盯多个终端"。【本机 `herdr pane` / `herdr --skill`】
- Paseo 的终端够用但不以布局见长：创建/列出/发键/截图/关闭（CLI 与 MCP 工具同构）。它的重点在 Chat 里的结构化视图。【官方】
- 图片显示：Herdr 的 kitty graphics 通道在本机有明确配置与历史实测记录（catppuccin 主题那次排查）。Paseo 终端继承外层终端能力，未在本机验证图片渲染。【未核实】

### 4.2 多 agent 派发、回传、可见性、会话恢复

- **派发**：Herdr 需要先有可用 shell pane，然后 `agent start`。名字必须匹配 `[a-z][a-z0-9_-]{0,31}` 且在活跃 agent 中唯一。Paseo 直接按 provider/model 起 agent，且能自动识别调用者，把新 agent 挂成子 agent。【官方·skill / 官方】
- **回传**：Herdr 回传的是终端渲染文本；大结果要靠 agent 自己写文件再报路径（skill 明确建议）。Paseo 有结构化时间线、`paseo logs --filter tools`、通知回注、手机查看。【官方】
- **可见性**：Herdr 的 Done 徽标由每个客户端各自记录，CLI 与其他客户端的徽标可能不同（skill 明说）。Paseo 的状态是 daemon 侧统一状态，多端一致。【官方】
- **会话恢复**：Herdr 有命名会话与快照；但 agent 身份跟着 pane 内容走，agent 退出就清名，不能跨进程恢复"这个 agent"。Paseo 把 agent 元数据写盘（`~/.paseo/agents/<workspace>/<agentId>.json`），其中 `persistence.nativeHandle` 指向 pi 的原生 session 文件，所以能 resume，还能导入你以前用 pi 命令行开过的会话。【本机·源码】
- **风险点**：Paseo 的 agent 是 daemon 的子进程。daemon 重启会结束这些进程。恢复能力是"重启后能续会话"，不是"进程不死"。重启后是否自动续跑，未核实。【未核实】

### 4.3 pi 项目规则、skills、extensions 与权限执行路径

- 规则：两种方式都读 cwd 的项目 `AGENTS.md` 与全局 `AGENTS.md`。Chat 另加 Paseo systemPrompt。规则优先级与内容细节由另一 worker 的报告覆盖。
- extensions：`~/.pi/agent/extensions/` 下的文件都会加载。其中：
  - `guard-system-install.ts` 用 `pi.on("tool_call")` 拦截 → 与 UI 模式无关，两种方式都在。是否实测拦到，未核实。【本机·代码】
  - `herdr-agent-state.ts` 由 Herdr 托管（文件中写明会被覆盖），需 `HERDR_ENV=1` → Paseo 下空转。【本机】
  - `pi-permission-system` 在 RPC 下仍生效，走单选提示，由客户端回答。本机配置 `yoloMode=true`，path/bash 规则仍保留 deny/ask 项。【本机 + 官方】
- 终端 vs Chat 的权限差别不在"有没有门"，而在"门画在哪"：终端里画在 pi 自己的 TUI；Chat 里画在 Paseo 客户端（桌面/手机/CLI `paseo permit`）。【官方】
- Paseo 的终端活动 hook 只装 claude/codex/opencode。所以 Paseo 不会为了追踪 agent 去改 pi 的配置文件。这一点对"最小改动"有利。【本机·源码】

### 4.4 桌面、手机、远程

- Paseo：官方原生 Desktop（mac/win/linux）、iOS/Android app、自托管 web UI、CLI、TS SDK、MCP。远程三选一：relay（端到端加密，daemon 出站连接）、SSH transport（不在远端安装任何东西）、Tailscale（直连 + 可选密码）。【官方】
- Herdr：只有 TUI 与 CLI。远程用 SSH attach 或已保存的 machine profile。注意 `herdr machine add` 会在远端"准备安装并启动 server"，且需要交互终端批准。【本机 `herdr machine` 帮助】
- 手机：Paseo 有原生 app。Herdr 只能从手机的 SSH 终端附着进 TUI，可用性未实测。【未核实】

### 4.5 配置备份与恢复、运维复杂度

- Herdr：状态集中在 `~/.config/herdr/`（config.toml、会话、快照、插件、日志）。本机已把 `config.toml` 软链进 dotfiles，恢复简单。缺点是 server 版本与 client 版本可能不同（`herdr status` 会报）；binary 更新走 `herdr update`。【本机】
- Paseo：配置在 `~/.paseo/config.json`，但**有效运行状态不止这一个文件**。见 `~/.paseo/`：`daemon-keypair.json`、`local-credential`、`server-id`、`projects/`、`agents/`、`creations/`、`agent-requests/`、`schedules/`、`push-tokens.json`。草稿 `deploy.sh` 目前只恢复 `config.json`。【本机】
- 更新节奏：Paseo stable 通道分 36 小时灰度；Desktop 与 daemon 一起走 app 更新路径。Herdr 有自己的 stable/preview 通道。【官方 / 本机】
- 复杂度对比：Paseo 多了一层 daemon（进程、端口、relay、配对、密码、CORS/host 白名单）。Herdr 只有本机 server + socket。若不需要手机与远程，Paseo 的运维面更大。【官方】

## 5. 对当前场景（pi + Antigravity、最小改动、不要 worktree）的评估

### 5.1 优势

1. Chat 模式给你 pi 的规则、skills、extensions 不变，同时加上远程、手机、多 agent 协作与结构化时间线。规则一致这一点已由源码路径确认。
2. Paseo 不写 pi 的配置（无 pi 终端 hook），也不强制 worktree（workspace 支持 local 隔离）。迁移面小。
3. Antigravity 是内置 provider（`agy` 加 `--dangerously-skip-permissions`），不需要额外插件。【官方】`paseo provider ls` 本机显示 pi 与 antigravity 均 available，其余被禁用。【本机】
4. 会话资产不丢：Chat 的 pi 会话写进 pi 自己的 session 目录，可继续用命令行 `pi --continue` 打开同一批文件。【本机·源码】

### 5.2 限制

1. Chat 里没有 pi 的 TUI。TUI 专属扩展界面在 RPC 下无效或降级。需要键盘交互、主题、编辑器组件、图片通道的任务，应放 Paseo 终端。
2. Paseo 终端里的 pi 不被 Paseo 追踪为 agent（无 hook）。所以"用 Paseo 管住终端里的 pi"这个期望不成立。
3. Antigravity 在 Paseo 只有 full-access 一种模式，且不能向用户提问。它的守卫只能靠 `agy` 自身策略。（细节由另一 worker 报告）【官方】
4. Paseo 工具目录限制不是执行沙箱。终端里就是普通 zsh，没有 pi 的安装守卫。草稿 POLICY.md 已写明这一点。
5. daemon 重启会中断运行中的 agent 进程；恢复靠续会话。【未核实：是否自动续跑】
6. Herdr 与 Paseo 同时运行会有两套状态（本机 Herdr server 现在仍在跑）。不会互斥，但资源与心智成本叠加。

### 5.3 最小改动建议（仅提案，本次不执行）

1. **保留 pi 的 Chat 用法为主**，把终端用法留给需要 TUI 的任务。两者共用 session 目录，可互补切换。
2. **不动 pi 的 extensions/skills 目录**。`herdr-agent-state.ts` 在 Paseo 下空转，无副作用，可先观察。
3. **保留 Herdr skills 软链**，但要知道它们在本环境不可用（`HERDR_ENV` 守卫）。是否 disable 由用户裁决，因为 disable 会改变 dotfiles 结构。
4. **补全 Paseo 备份清单**：除 `config.json` 外，至少评估 `daemon-keypair.json`（relay 配对身份）、`local-credential`、`projects/`、`agents/` 是否需要纳入备份。恢复后 relay 配对是否失效需实测。【未核实】
5. **在 POLICY 里写死两条边界**：① Paseo 终端不等于受守卫环境；② Antigravity 在 Paseo 是 full-access。草稿已有第①条。
6. **不启用 worktree 隔离**（与现有约定一致）。workspace 用 local 隔离即可。
7. **不要为迁移而修改 pi 的权限系统配置**。Chat 下它工作正常，只是提示画在 Paseo 客户端。

## 6. 未证实项（需要后续验证）

| 项 | 说明 |
|---|---|
| Chat 下 `ui.setStatus` 等 fire-and-forget 界面调用是否显示 | 影响 `turn-timer` 等扩展在 Chat 里的可用性 |
| daemon 重启后运行中的 pi agent 是否自动续跑 | 目前只确认历史可 resume |
| Paseo agent profiles 的具体存储文件 | 未在 `~/.paseo` 下定位到 |
| relay 关闭或 PASEO_HOME 迁移后的配对行为 | 影响备份恢复方案 |
| Paseo 终端内 pi 的 agent 识别 | 本机源码显示无 pi hook，但未做运行时验证 |
| Paseo 终端图片（kitty graphics）渲染 | 未验证 |
| 手机端查看终端与 Chat 的实际体验 | 未验证 |
| Herdr 从手机 SSH 附着的可用性 | 未验证 |
| Antigravity hooks（`hooks.json`）是否被 Paseo 的 `agy` 启动路径读取 | 由另一 worker 覆盖 |
| 两套系统长期并行运行的资源与状态影响 | 未测量 |

## 7. 证据索引

官方文档（2026-10-16 取用）：

- 索引：https://paseo.sh/llms.txt
- Why：https://paseo.sh/docs/why.md
- Workspaces：https://paseo.sh/docs/workspaces.md
- Providers / Supported providers：https://paseo.sh/docs/providers.md 、 https://paseo.sh/docs/supported-providers.md
- Orchestration / Skills / Profiles：https://paseo.sh/docs/orchestration.md 、 https://paseo.sh/docs/skills.md 、 https://paseo.sh/docs/agent-profiles.md
- MCP 参考：https://paseo.sh/docs/mcp.md
- CLI 参考：https://paseo.sh/docs/cli.md
- Security / Connectivity / Configuration / Updates：https://paseo.sh/docs/security.md 、 https://paseo.sh/docs/connectivity.md 、 https://paseo.sh/docs/configuration.md 、 https://paseo.sh/docs/updates.md
- pi RPC：`docs/rpc.md`、`docs/rpc-extension-ui.md`（本机 `/Users/panyu/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/docs/`）

本机源码（只读，从 `/Applications/Paseo.app/Contents/Resources/app.asar` 按头部偏移提取到 `/tmp`，未安装任何东西）：

- pi provider 启动参数：`node_modules/@getpaseo/server/dist/server/server/agent/providers/pi/runtime.js`（`buildPiLaunch`、`--mode rpc`）
- RPC 子进程：同目录 `cli-runtime.js`、`jsonl-rpc-process.js`（`stdio: [pipe,pipe,pipe]`）
- 注入的 extension 与 MCP 配置：同目录 `agent.js`（`createPiPaseoExtensionFile`、`createPiMcpConfigFile`、`pi.registerMcpServer`）
- pi 会话导入：同目录 `session-descriptor.js`（读 `~/.pi/agent/sessions`）
- 终端活动 hook 范围：`dist/server/terminal/agent-hooks/provider-registry.js`（仅 claude/codex/opencode）
- zsh 集成与 OSC 633：`dist/server/terminal/shell-integration/zsh/{.zshenv,paseo-integration.zsh}`
- 真 PTY：`app.asar.unpacked/node_modules/node-pty`

本机运行时事实：

- `paseo --version` = 0.11.4；`paseo daemon status --json`：`desktopManaged: true`，`listen 127.0.0.1:6767`
- `paseo provider ls`：pi=available/Enabled，antigravity=available/Enabled，claude/codex/opencode/copilot/muse/omp=Disabled
- `~/.paseo/agents/Users-panyu-Documents-github-INVEST/*.json`：`{provider:"pi", persistence.nativeHandle:"~/.pi/agent/sessions/.../<id>.jsonl"}`
- 会话环境变量：`PASEO_TERMINAL_ID`、`PASEO_WORKSPACE_ID`、`PASEO_ACTIVITY_TOKEN`、`PASEO_HOOK_CLI` 存在；`HERDR_ENV` 不存在
- `herdr --version` = 0.9.5；`herdr status`：server running，protocol 22，socket `~/.config/herdr/herdr.sock`
- `herdr integration status`：`pi: current (v9) (/Users/panyu/.pi/agent/extensions/herdr-agent-state.ts)`；`antigravity-cli: outdated (v3 < v4)`
- `herdr agent` 支持的 kinds 含 `pi` 与 `agy`
- Herdr 的 pi integration 文件开头写明：`// installed by herdr` / `// managed by herdr; reinstalling or updating the integration overwrites this file.`
- pi 权限系统：`~/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system/docs/configuration.md:269`（"Non-TUI contexts (RPC / frontend-driven sessions) keep the single-select prompt"）

未修改的文件：dotfiles 里 `mac/paseo/` 草稿与会诊记录均未改动。本报告是本次唯一新增文件，未提交。
