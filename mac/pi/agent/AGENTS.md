# Global Instructions

## Response Style (highest priority; all projects)

Write your answers in Chinese. You can use English words for technical names. Keep the language easy to read. The whole answer must also obey the ASD-STE100 standard.

## Tool Use

- 搜索：先用 `grep` 或 `find`（同名工具已由 fff 插件接管：frecency 排序、模糊匹配）。一次调用可以含多个 term（OR logic）。只有它们做不到的操作才用 bash。
- 读文件：用 `read` 的 `offset` 和 `limit` 参数，只读 match 附近的内容。已知文件在 workspace 之外时，用 `read` 加绝对路径。

## Agent 协作

- 用户授权委派后，在当前 Pi 会话调用 `pi-subagents` 的 `subagent` 工具。单项任务直接指定角色和任务，默认使用后台执行。参数用 `/subagents-guide` 或包内 skill 核对。
- `subagent`、`subagents_enable` 与 supervisor 工具仅供模型直接调用，不能从 codemode 搜索或调用。入口不可用时报告缺失；不得另起 Pi CLI、RPC 或其它后端代替当前会话派发。
- 父子任务的结果、进展和问答使用原生完成通知、`contact_supervisor` 与 `subagent_supervisor`。Fleet 只显示当前父会话拥有的任务；普通异步任务靠完成通知唤醒，不循环轮询。
- worker 模型：本次调用的显式模型优先，其次配置的 worker/defaultModel。没有可用配置时先报告，不能自行选择父会话或 CLI 默认模型。配置真源是 `~/.pi/agent/settings.json` 的 `subagents` 段。
- 内置 Pi 角色通过 `inheritProjectContext: true` 和 `inheritGlobalContext: true` 继承项目与全局规则，包括下文的系统级安装禁令。新增自定义角色也要配置这两项。
- Herdr 负责终端、tab、pane 和独立 CLI 会话。操作前运行 `test "${HERDR_ENV:-}" = 1`，通过后用 `herdr --skill` 现取官方正文；`herdr agent`、`pane`、`tab` 无子命令时显示用法。不要运行裸 `herdr`。
- 当前父会话内用 `/subagents-fleet` 查看任务；选中运行中的后台子任务，按 `H` 打开 Herdr inspector。监控窗格展示运行记录，不是完整子会话的交互界面。
- intercom 仅用于独立会话之间的交流；同一项任务只投递一次。父子任务使用原生完成通知，不再重复发送 intercom 完成消息。
- 任务书写清允许改动的路径、交付物和验证标准。并行写入范围互不重叠，合并串行处理。生命周期结束后仍须验收产出。`blocked` 保留人工关卡，投递超时先检查记录再决定，不能盲目重发。
- `herdr-dispatch` 与依赖它的 `herdr-swarm` 已停用部署。源码和历史保留；日常协作使用上述入口。


## External Search (GitHub)

- 分工：search 用 `gh`，deep read 用 `fetch_content`。
- `gh` 已安装（Homebrew，`/opt/homebrew/bin/gh`）。**不得重装。**
- 认证：wrapper `~/.pi/agent/bin/gh` 在 run time 从 KeePassXC 的 `apienv` vault、`github` entry 取 `GH_TOKEN`。token 不写入 disk。pi 会话里 `gh` 直接命中这个 wrapper。private repo 和 high rate limit 必须带 token。
- Search：用 `gh search repos|code|issues|commits`。可以按 star、language、update time 筛选。支持 code-level search。
- Deep read：用 `fetch_content`。它内部调用 `gh`，完成 `gh repo clone`、PR parse、issue parse。没有 `gh` 时 fallback 到 `git clone`，这时读不了 private repo。
- Rate limit：core = 5000/h；search = 30/min；code search = 10/min。未认证时分别是 60/h、10/min、不可用。
- 换 token：GitHub 发新 token 后，只更新 KeePassXC 的 `github` entry。wrapper 不用改。

## Skill Installation

- 安装一律用 **copy**：从 official source（GitHub repo 或 official skill market）取 skill 目录，copy 到目标 skill 目录（例如 `~/.pi/agent/skills/<name>`）。然后按需做本机适配（KeePassXC key injection、`uv` dependency 声明）。方法与案例见 dotfiles 的 `mac/omp/search-skills-deploy.md`。
- **不得用 `npx skills add`**：它会 copy 到本机检测到的多个 agent 目录，且不带 local patch；`skills remove -g` 还会删除 main deployment。

## Local Rules (macOS)

- remote git 操作失败时（push、pull、SSH permission error）：立即停止。不得 retry。不得换 remote、不得换 protocol、不得试其它 SSH key。提醒用户 unlock KeePassXC，然后等确认。
- 不得做 system-level install（`pip install`、`npm -g`、`brew install` 等）。Python 一律用 `uv`，包括 `-c` one-liner 和 heredoc。不得用 system python3。项目 Python 环境由 `uv` 管理。Node 用 `bun`、`bunx` 或 `npx`，在项目内执行。看 JSON 先用 `jq` 或内置 `read`。需要 Python 时才用 `uv`。
