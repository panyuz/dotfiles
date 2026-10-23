# Global Instructions

## Response Style (highest priority; all projects)

回复用中文，技术名可保留英文。全篇遵守 ASD-STE100 标准：短句、一义一句、主动语态。

调研先定范围与时限；到时保存已有产物并收尾。范围要扩大时先报告。

## Tool Use

- 搜索：先用 `grep` 或 `find`（fff 插件接管：frecency 排序、模糊匹配）。一次调用可含多个 term（OR）。
- 读文件：用 `read` 的 `offset`/`limit`，只读 match 附近。已知文件在 workspace 之外时用绝对路径。
- 看 JSON 用 `jq` 或内置 `read`。
- 只有 `grep`/`find`/`read` 做不到时才用 `bash`。

## Agent 协作

- 只有用户已授权委派才用子任务；直接执行是默认。单项任务直接派发：
  `subagent({ agent: "worker", task: "…", async: true })`。
- 多步、并行或流程不确定时，先按 topic 读官方参考：
  `subagent({ action: "guide", options: { topic: "workflows" } })`。
  常用 topic：`workflows`（流程）、`agents`（角色）、`tool-reference`（全部参数）。普通单项任务不先读手册。
- 参数报错或字段不确定时，用 `action: "guide"` 读单一 topic 或 `<topic>/<section>`；不猜参数，不用 CLI、RPC 或其它后端顶替。用户侧入口是 `/subagents-guide [topic]`。
- 当前上下文没有 `subagent` 入口时，可调用一次 `subagents_enable({})`；仍不可用就报告并停止。
- `subagent`、`subagents_enable` 与 supervisor 工具只由模型直接调用，codemode 不能搜索或调用。
- 包内 `pi-subagents` skill 讲派发模式；`action: "guide"` 给当前安装版本的权威参考。两者都按需加载。
- 父子通信用原生通道：子任务用 `contact_supervisor`，父会话用 `subagent_supervisor` 与完成通知；原生通道不需要 `pi-intercom`。`intercom` 只用于独立会话之间，同一任务只投递一次。
- Fleet 只显示当前父会话的任务。用 `/subagents-fleet` 查看；选中运行中的任务按 `H` 打开 Herdr inspector。监控窗格只展示运行记录，不能交互。异步任务靠完成通知唤醒，不轮询。
- worker 模型：本次调用的显式模型优先，其次配置的 worker/defaultModel。没有可用配置时先报告，不能自行选择父会话或 CLI 默认模型。配置真源是 `~/.pi/agent/settings.json` 的 `subagents` 段。
- 内置 Pi 角色用 `inheritProjectContext: true` 和 `inheritGlobalContext: true` 继承项目与全局规则，含系统级安装禁令。新增自定义角色也要配置这两项。
- 任务书写清允许改动的路径、交付物和验证标准。并行写入范围互不重叠，同一范围同时只有一个 writer；合并串行处理。生命周期结束后仍须验收产出。`blocked` 保留人工关卡；投递超时先检查记录再决定，不盲目重发。
- Herdr 负责终端、tab、pane 和独立 CLI 会话。操作前运行 `test "${HERDR_ENV:-}" = 1`，通过后用 `herdr --skill` 现取官方正文；`herdr agent`、`pane`、`tab` 无子命令时显示用法。不要运行裸 `herdr`。
- `herdr-dispatch` 与依赖它的 `herdr-swarm` 已停用部署；源码和历史保留。日常协作使用上述入口。

## External Search (GitHub)

- search 用 `gh`，deep read 用 `fetch_content`。
- `gh` 已安装（Homebrew，`/opt/homebrew/bin/gh`），不得重装。
- 认证：wrapper `~/.pi/agent/bin/gh` 在 run time 从 KeePassXC 的 `apienv` vault、`github` entry 取 `GH_TOKEN`。token 不写入 disk。pi 会话里 `gh` 直接命中这个 wrapper。private repo 和高 rate limit 必须带 token。
- Search 用 `gh search repos|code|issues|commits`，可按 star、language、更新时间筛选；code search 可用。
- Rate limit：core 5000/h、search 30/min、code search 10/min；未认证时 60/h、10/min、code search 不可用。
- Deep read：`fetch_content` 内部用 `gh` 完成 `gh repo clone`、PR parse、issue parse。没有 `gh` 时 fallback 到 `git clone`，这时读不了 private repo。
- 换 token：GitHub 发新 token 后，只更新 KeePassXC 的 `github` entry；wrapper 不用改。

## Skill Installation

- 安装一律用 copy：从 official source（GitHub repo 或 official skill market）取 skill 目录，copy 到目标 skill 目录（例如 `~/.pi/agent/skills/<name>`）。然后按需做本机适配（KeePassXC key injection、`uv` dependency 声明）。方法与案例见 dotfiles 的 `mac/omp/search-skills-deploy.md`。
- 不用 `npx skills add`：它会 copy 到本机检测到的多个 agent 目录，且不带 local patch；`skills remove -g` 还会删除 main deployment。

## Local Rules (macOS)

- remote git 操作失败时（push、pull、SSH permission error）：立即停止。不得 retry，不得换 remote、换 protocol 或试其它 SSH key。提醒用户 unlock KeePassXC，然后等确认。
- 不得做 system-level install（`pip install`、`npm -g`、`brew install` 等）。Python 一律用 `uv`（含 `-c` one-liner 和 heredoc），不得用 system python3；项目 Python 环境由 `uv` 管理。
- Node 用 `bun`、`bunx` 或 `npx`，在项目内执行。
