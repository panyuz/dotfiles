# Herdr 与 cmux 对比调研（只读）

## 0. 元信息

| 项目 | 内容 |
|---|---|
| 调研时间 | 2026-10-16 18:11 CST（`date` 命令取值） |
| 调研范围 | 仅 Herdr 与 cmux。终端/标签/面板架构、多 agent 管理、状态通知与权限等待、pi 与 Antigravity CLI 集成、CLI 自动化与结果回收、配置维护、远程与移动、平台限制 |
| 方法 | 本机只读检查 + 官方文档/源码只读抓取 + `herdr --help/--version`（未运行裸 `herdr`） |
| 未执行动作 | 未安装、未改配置、未重启服务、未创建 worktree、未派发 agent、未动 dotfiles 草稿 |
| 版本基线 | Herdr `0.9.5`（本机二进制 2026-10-15 07:18，官方 release v0.9.5 / 2026-10-14）；cmux 未安装，官方最新 release `v0.65.2` / 2026-10-16 |
| 文档基线 | Herdr 文档固定到 tag `v0.9.5`；cmux 用 GitHub `main` 文档与 cmux.com 页面 |

标记约定：**[证实]** = 官方文档或本机只读输出可见；**[本机]** = 本机状态证据；**[第三方]** = 非官方来源；**[未证实]** = 无可靠来源，不能断言。

## 1. 项目身份确认（避免同名项目）

| 名称 | 身份 | 证据 |
|---|---|---|
| Herdr | `herdrdev/herdr`，Rust 单二进制终端工作区管理器（runtime + clients），主页 herdr.dev，Apache-2.0，44.3k stars（2026-10-16 读取） | [herdr.dev](https://herdr.dev/)、[GitHub](https://github.com/herdrdev/herdr) |
| cmux（本次对象） | `manaflow-ai/cmux`，Swift/AppKit 原生 macOS 终端（基于 libghostty 渲染），主页 cmux.com，cask 名 `cmux`，28.2k stars（同日读取） | [GitHub](https://github.com/manaflow-ai/cmux)、[brew cask](https://formulae.brew.sh/cask/cmux) |
| cmux（**同名，不要混**） | Coder 的 `cmux`：GUI「Coding Agent Multiplexer」，非本次对象 | [HN 讨论](https://news.ycombinator.com/item?id=45596024) |

本机身份证据 **[本机]**：`~/.gemini/config/hooks.json` 里残留的 cmux hook 组引用 `CMUX_SOCKET_PATH`、`CMUX_BUNDLED_CLI_PATH`、`/Applications/cmux.app/Contents/Resources/bin/cmux`、`~/.local/state/cmux/cmux.sock`，与 `manaflow-ai/cmux` 的 CLI/socket 约定一致；此 cmux 由 `brew install --cask cmux` 装入，App 现已移除，cask 目录 `/opt/homebrew/Caskroom/cmux` 不存在。

## 2. 对照表

### 2.1 定位与架构

| 维度 | Herdr | cmux |
|---|---|---|
| 是什么 | 后台 server 持有真实 PTY；TUI/CLI/SSH 都是 client [证实] | 原生 macOS 终端 App（Swift+AppKit + libghostty）；不是多路复用器 [证实] |
| 分层 | 工作区 workspace → tab → pane；另有无头 server、命名 session [证实] | workspace → surface（tab）；pane 可左右/上下切分 [证实] |
| 终端归属 | 运行在**现有**终端内（Ghostty/Paseo 终端均可），不改终端 [证实] | **替换**终端；读取 `~/.config/ghostty/config` 取主题/字体/颜色 [证实] |
| 关闭 UI 后 | client 关闭/掉线不休；`ctrl+b q` detach，`herdr` 重连 [证实] | App 退出后由 App 快照恢复布局；活进程要显式开 `cmux local-tmux`（tmux 当持有者）[证实] |
| 机器重启后 | 恢复布局并本地恢复支持的 agent 会话；**原进程不存活** [证实] | 同上：非杀进程恢复；`local-tmux` 也不跨关机 [证实] |
| 鼠标/键盘 | 键盘 prefix + 鼠标同等一等 [证实] | 原生 macOS 快捷键 + 命令面板 [证实] |

### 2.2 多 agent 管理与状态

| 维度 | Herdr | cmux |
|---|---|---|
| 语义状态 | `blocked` / `working` / `done` / `idle` / `unknown`，按 pane → tab → workspace 上卷 [证实] | hook 记录生命周期 `running` / `idle` / `needsInput` / `unknown`；通知分类 turn-complete / needs-permission / idle-reminder [证实] |
| 状态来源 | 进程识别 + 屏幕 manifest；安装了会报送状态的集成时以集成为准 [证实] | agent hook（各 CLI 原生 hook/插件/扩展）+ OSC 9/99/777 [证实] |
| 权限等待 | 严格匹配屏幕上的审批/提问界面才算 `blocked`；匹配不上回落 `idle`（有 explain 输出可查）[证实] | 通知分类含 `needs-permission`；部分 agent 支持 Feed 审批卡 [证实] |
| 通知方式 | 应用内 toast，可选 delivery：`off` / `herdr`(应用内) / `terminal`(向外部终端发桌面通知) / `system`(走 macOS 通知中心)；分 agent 声音、延迟秒数 [证实] | pane 蓝色环 + 侧栏未读徽标 + 通知面板；`⌘⇧U` 跳到最近未读；窗口聚焦/当前工作区/面板打开时抑制横幅 [证实] |
| 声音/延迟 | `ui.sound.enabled`、`ui.sound.agents.<agent>` 可逐个覆盖；`ui.toast.delay_seconds` [证实] | 系统声音选择器 + 自定义通知命令（`CMUX_NOTIFICATION_*` 环境变量）[证实] |
| 等待原语 | `herdr agent wait`、`herdr agent prompt --wait`（等到真的 blocked/结束）[证实] | CLI 参考里未列出「等 blocked」类命令；socket 方法列表未见 [未证实存在] |
| 子 agent | 每个 agent 一个 pane；Herdr 不包装 agent [证实] | 子 agent/teammate 变成原生 pane/split；支持 Claude Code Teams、oh-my-opencode [证实] |

### 2.3 pi 与 Antigravity CLI 集成

| 维度 | Herdr | cmux |
|---|---|---|
| pi | 集成写 `~/.pi/agent/extensions/herdr-agent-state.ts`；**pi 直报状态**（不走屏幕识别）；原生恢复会话 [证实] | 扩展写 `~/.pi/agent/extensions/cmux-session.ts`；记录会话 ID 与工具执行遥测；恢复命令 `pi --session <id>`；Pi 不进 Feed 审批 [证实] |
| Antigravity CLI（`agy`） | 集成只报告会话（session-only），**状态仍由屏幕识别**；hook 挂 `PreInvocation`；恢复 `agy --conversation <id>` [证实] | hook 组写在 `~/.gemini/config/hooks.json` 的 `cmux` 键；恢复 `agy --conversation <id>`；Feed 桥接为 none [证实] |
| 本机集成现状 | `herdr integration status`：pi **current (v9)**、omp current (v10)、**antigravity-cli outdated (v3 < v4)**，其余未安装 [本机] | 未安装（App 已移除）[本机] |
| 对本机钩子文件的影响 | 只写/删自己那份 pi 扩展；`agy` 只改 hooks.json 的 `herdr` 键，不动其他命名钩子 [证实] | 只改 hooks.json 的 `cmux` 键；pi/Antigravity 各写自己的文件 [证实] |
| 残留 | `~/.gemini/config/hooks/herdr-agent-state.sh` 仍在，且版本落后（v3 < v4）[本机] | `~/.gemini/config/hooks.json` 仍有 `cmux` 键，命令指向已删除的 `/Applications/cmux.app`（失败时回退输出 `{}`）；`~/.cmux/{local-tmux,ssh}` 为空目录 [本机] |

注：两份 pi 扩展文件名不同（`herdr-agent-state.ts` / `cmux-session.ts`），**可以并存**；同一 agent 装两套钩子会重复上报，维护上建议只留一套。

### 2.4 CLI 自动化与结果回收

| 维度 | Herdr | cmux |
|---|---|---|
| 控制面 | CLI + 本地 socket API，命令输出 JSON [证实] | CLI + Unix socket（`/tmp/cmux.sock`，可用 `CMUX_SOCKET_PATH` 改）[证实] |
| 主要动作 | workspace/tab/pane/worktree/session/machine；`agent list\|read\|send-keys\|prompt\|wait\|attach`；`terminal session observe\|control`（只读帧流 / 交互控制）[证实] | `new-workspace`、`new-split`、`focus-panel`、`send`、`send-key`、`notify`、`set-status`、`set-progress`、`log`、`list-panels` [证实] |
| 结果回收 | `agent wait` 等状态；`agent read` 读 pane；有 deliverable/envelope 约定（本机技能层）[证实] | 无「等 blocked」；靠 hook 上报的会话状态与通知面板；`cmux sessions --agent <name> --json` 查已存会话 [证实] |
| 访问控制 | 本机 socket；同机用户边界 [证实] | socket 三种模式：Off / 仅 cmux 内进程 / allowAll；共享机器建议前两者 [证实] |
| 其他自动化 | 插件（manifest actions + 事件钩子 + pane）、插件市场 [证实] | 应用内浏览器可脚本化（agent-browser API）；项目 `.cmux/cmux.json` 自定义命令与通知钩子（首次运行需信任确认）[证实] |
| 本机配套 | 现有 `herdr-dispatch` / `herdr-swarm` 技能（入口软链接已停用，真源保留）[本机] | 无（已卸载，规则禁止恢复 hooks）[本机] |

### 2.5 远程与移动

| 维度 | Herdr | cmux |
|---|---|---|
| SSH | 可 SSH 进服务器直接跑；`herdr --remote <host>` 本地渲染远程 pane；侧栏可同时挂多台已保存机器，各自独立重连 [证实] | `cmux ssh user@remote` 建工作区；支持 `ssh-tmux` / `mosh-tmux`；远程浏览器 pane 走远程网络 [证实] |
| 远程限制 | 本机与远程版本无需一致；非交互环境不能弹密钥口令 [证实] | 远程 Claude 权限提示留在远端；CLI relay 负责状态/通知/会话 ID [证实] |
| 手机 | **官方未见移动 App**；[第三方] 称用普通 SSH 客户端即可，另有社区项目（Moshi、herdr-mobile-relay）[第三方/未证实] | iOS/iPadOS companion（TestFlight 内测，署名 cmux BETA）；需 cmux 账号 + 同一网络（内置 iroh 或自带 Tailscale），Mac 需保持唤醒；早期访问含在付费 Founders Edition 内 [证实] |
| 云执行 | 无自有云产品（用你自己的机器/服务器）[证实] | 有 Cloud VM 付费产品（Pro $50/mo、Max $200/mo、Team $60/user/mo；免费账号无 Cloud VM）[证实] |

### 2.6 配置维护、平台与许可

| 维度 | Herdr | cmux |
|---|---|---|
| 配置文件 | 单文件 `~/.config/herdr/config.toml`（本机已 symlink 进 dotfiles）[本机]；另有插件目录、`~/.config/herdr/agent-detection/<agent>.toml` 本地覆盖 [证实] | `~/.config/cmux/cmux.json` + 设置界面 + 复用 `~/.config/ghostty/config`；项目级 `.cmux/cmux.json` [证实] |
| 热更新 | `herdr server reload-config`；键位/主题改动区别对待（部分需整机重启）[证实] | `⌘⇧,` 重载配置；Sparkle 自动更新 [证实] |
| 升级后要做的维护 | `herdr integration status` 检查集成版本，过旧则重装该集成（本机 `agy` 已过旧）[本机] | 升级后按需重跑 `cmux hooks <agent> install --yes`（hook 指向 App 内路径）[证实] |
| 平台 | Linux / macOS / Windows（Windows 为 beta，有已知限制）；远程可指派 Linux/macOS/Windows 主机 [证实] | **仅 macOS**（cask 要求 macOS ≥ 14）；iOS 为 companion [证实] |
| 许可 | Apache-2.0 [证实] | App/CLI 等 GPL-3.0-or-later；`web/`、`workers/*`、`services/iroh-relay-minter/`、`cmux-tui/relays/cloudflare-do/` 为 BUSL-1.1，生产自托管需商业许可 [证实] |
| 体量/生态 | 44.3k stars；插件市场；厂商有对比页（自述口径，属宣传材料）[证实] | 28.2k stars；Discord 社区；日志/更新频繁（v0.65.2，当日发布）[证实] |

## 3. 本用户场景下的选择依据

场景事实 **[本机]**：现用 Paseo 管理 pi 与 Antigravity CLI；OMP 已停用；不使用 worktree；Herdr 技能软链接已停用（真源保留）；cmux 已卸载且禁止恢复其 hooks；本机 herdr 0.9.5 服务仍在运行，config.toml 仍由 dotfiles 管理。

不预设优劣。按**触发条件**选：

| 若你的首要需求是 | 更贴合的一方 | 理由（均为上文已证实项） |
|---|---|---|
| agent 不因关窗/掉线而死，且**不换终端**（继续在 Paseo 的终端里工作） | Herdr | server 持 pane；TUI 只是首个 client；可 SSH 直达 |
| 跨多台机器看一处 agent 状态（本地 + 服务器） | Herdr | 已保存机器在同一窗口，独立重连；CLI 支持 `--machine` |
| 脚本/agent 需要「等到真的 blocked」再继续 | Herdr | 有 `agent wait`、`agent prompt --wait`；cmux 未见同类原语 |
| 需要强视觉提示（pane 环、侧栏徽标、未读面板）与**审批卡** | cmux | 通知环/面板 + Feed 审批卡；权限通知分类明确 |
| 要 GUI 终端 + 应用内浏览器（让 agent 直接点网页） | cmux | 应用内浏览器带 agent-browser 风格脚本 API |
| 手机上看/管 agent | cmux（官方路径）或 Paseo 现有 relay | cmux iOS 内测 + 账号配对；Herdr 无官方移动 App |
| 只用 macOS、接受 GPL/BUSL 与付费云 | cmux | 仅 macOS；云 VM 与移动早期访问属付费层 |
| 要求 Apache-2.0 与跨平台二进制 | Herdr | Apache-2.0；Linux/macOS/Windows |
| 与现有 Paseo 分工不重叠 | Herdr 更不重叠；cmux 会与 Paseo 的 GUI/移动角色重叠 | Paseo 已提供 GUI + relay 移动；Herdr 属于「下面的 runtime」 |

对 pi / Antigravity CLI 的差别（本场景核心）：pi 在两边都是一等公民（Herdr 用 pi 直报状态；cmux 用扩展记录会话与遥测）。Antigravity CLI 一边强一边弱：cmux 用 5 类事件（SessionStart/PreInvocation/Stop/turn-completion/Notification **[本机残留 hooks.json]**）驱动通知与会话恢复；Herdr 侧 `agy` 是 session-only，状态靠屏幕识别，且本机 hook 已过旧（v3 < v4）——若要用 Herdr 管 `agy`，需重装该集成才能恢复会话 **[本机]**。

## 4. 最小维护建议（不建议现在执行任何动作）

1. **只留一个「谁的 UI 持有终端」**。Herdr 与 cmux 都能持有 PTY；同时使用会让「谁在跑 agent」不明确。Paseo 已占 GUI/移动位置，Herdr 属终端内 runtime，重叠最小。
2. **每个 agent 只装一套钩子**。pi 的 `herdr-agent-state.ts` 与 `cmux-session.ts` 可共存但会重复上报；`~/.gemini/config/hooks.json` 同理，只保留一个键组（现在是 `herdr` + 残留 `cmux`）。
3. **Herdr 若继续用**：保留 `config.toml` 的 dotfiles symlink；每次 `herdr update` 后跑一次 `herdr integration status`，把过旧集成（当前 `antigravity-cli`）重装；通知 delivery 已有本机结论（`system`）。
4. **cmux 若回归**：升级后重跑 `cmux hooks <agent> install`；把 hooks.json 的 `cmux` 键交给 dotfiles 的 deploy 流程管理；接受 macOS-only、GPL/BUSL 与云/移动付费层。
5. **键位/socket 独立性**：Herdr 默认 prefix `ctrl+b`（本机改 `ctrl+a`）、socket `~/.config/herdr/herdr.sock`；cmux socket `/tmp/cmux.sock`、`CMUX_*` 环境变量。两者控制面互不冲突。

## 5. 本机残留与现状（只读记录，未改动）

| 项 | 状态 |
|---|---|
| herdr 二进制 | `0.9.5`，`~/.local/bin/herdr`（2026-10-15 07:18） |
| herdr server | `running`，socket `~/.config/herdr/herdr.sock`，endpoint 兼容 |
| herdr 集成 | pi current(v9)、omp current(v10)、antigravity-cli **outdated(v3<v4)**，其余 not installed |
| herdr 通知配置 | `[ui.toast] delivery = "system"`、`delay_seconds = 2`（dotfiles 中的 config.toml） |
| cmux App | 已移除（`/Applications/cmux.app` 不存在，Caskroom 无记录） |
| cmux 残留 | `~/.gemini/config/hooks.json` 的 `cmux` 键（命令含 `CMUX_ANTIGRAVITY_HOOKS_DISABLED` 等）；`~/.cmux/local-tmux`、`~/.cmux/ssh` 空目录 |
| dotfiles 草稿 | `install.sh`、`mac/pi/agent/AGENTS.md` 已修改，`mac/paseo/` 未跟踪；**按要求未执行、未回滚、未提交** |

## 6. 证据链接

Herdr（官方，固定 tag v0.9.5）：
- 首页与整体定位：https://herdr.dev/ ；仓库与 README：https://github.com/herdrdev/herdr
- 文档索引（本次入口）：https://herdr.dev/llms.txt
- 概念（workspace/tab/pane/agent/session、状态表）：`docs/concepts.mdx`
- 支持的 agent 与状态来源、blocked 严格判定、manifest：`docs/agents.mdx`
- 集成安装（pi、antigravity-cli、hook 落点与恢复命令）：`docs/integrations.mdx`
- 持久化与远程：`docs/persistence-remote.mdx`、`docs/connecting-machines.mdx`
- CLI 参考（notification show、session、agent wait 等）：`docs/cli-reference.mdx`
- 配置项默认值（`ui.toast.delivery`、`ui.sound.*`）：`docs/next/website/src/data/config-reference.json`
- 官方对比页（宣传口径）：https://herdr.dev/compare/
- Windows beta：`docs/windows-beta.mdx`

cmux（官方）：
- 仓库与 README（功能、快捷键、会话恢复、FAQ、平台）：https://github.com/manaflow-ai/cmux
- 官网与定价：https://cmux.com/ 、https://cmux.com/pricing （Cloud VM 为付费项）
- CLI 参考与 socket、访问模式、环境变量：https://cmux.com/docs/api
- 通知机制（OSC 9/99/777、通知分类、抑制规则、钩子）：https://cmux.com/docs/notifications
- Agent hook 集成（支持的 agent 表、落点、恢复命令、Feed、Antigravity 组）：https://github.com/manaflow-ai/cmux/blob/main/docs/agent-hooks.md
- 本地 tmux 持久化与其限制：https://github.com/manaflow-ai/cmux/blob/main/docs/local-tmux.md
- iOS 配对与网络要求：https://cmux.com/docs/ios
- 许可（GPL-3.0-or-later + BUSL-1.1 目录清单）：https://github.com/manaflow-ai/cmux/blob/main/LICENSE
- 同名项目区分：https://news.ycombinator.com/item?id=45596024

第三方（参考，非权威）：
- https://flaviocopes.com/herdr-vs-cmux/ ；https://flaviocopes.com/herdr-phone/ （手机用普通 SSH 客户端）
- https://getmoshi.app/guides/herdr ；https://github.com/0cv/herdr-mobile-relay （社区手机方案）

## 7. 限制与未证实项

1. **口径偏差**：herdr.dev/compare 与 cmux 官网均为厂商材料。本报告只把它们当能力清单来源，不作优劣判据。
2. **版本快变**：cmux 当日发版（v0.65.2），文档随 `main` 变动；Herdr 文档固定 v0.9.5。跨月复核需重取。
3. **未证实项**：cmux 是否存在「等 agent blocked」原语（CLI 参考未列，不能断言没有）；Herdr 是否已有官方移动客户端（官方文档未见，第三方称无）；cmux Feed 在各 agent 上的完整覆盖。
4. **部分 cmux 页面取不到**：`cmux.com/docs/feed` 与 `cmux.com/docs/local-tmux` 返回 404/空页，改用 GitHub `docs/` 原文；`/docs/changelog` 超过抓取上限。
5. **本机证据有时效性**：hook 残留、集成版本、App 存在性均为 2026-10-16 读取值。
6. **未做的验证**：未启动 Herdr TUI、未运行任何 cmux 命令（App 不存在）、未安装任何软件、未修改任何配置或钩子。
7. **复核方法**：`herdr --version`、`herdr integration status`、`ls /Applications/cmux.app`、`jq 'keys' ~/.gemini/config/hooks.json`、`gh release view -R manaflow-ai/cmux`、`gh release view -R herdrdev/herdr`。
