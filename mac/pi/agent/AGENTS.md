# Global Instructions

## Response Style (highest priority; all projects)

Write your answers in Chinese. You can use English words for technical names. Keep the language easy to read. The whole answer must also obey the ASD-STE100 standard.

## Tool Use

- 搜索：先用 `grep` 或 `find`（同名工具已由 fff 插件接管：frecency 排序、模糊匹配）。一次调用可以含多个 term（OR logic）。只有它们做不到的操作才用 bash。
- 读文件：用 `read` 的 `offset` 和 `limit` 参数，只读 match 附近的内容。已知文件在 workspace 之外时，用 `read` 加绝对路径。

## Agent 协作（Herdr /）

按当前环境选择管理层：在 Herdr 内用 Herdr 规则。

**Herdr **

- **派发/回收 worker → 用 `herdr-dispatch` skill**（`assign` · `handoff` · `watch` · `collect` · `send`；自带 job store + 交付物读取 + 有界 watch ≤60s）。**不要手写原始 `herdr agent start/wait/prompt` 序列**。
- herdr 命令语法不留本地文档：跑 **`herdr --skill`** 现取官方正文（随二进制走，免漂移；herdr skill 已停用，这个开关就是替代）；`herdr agent` / `herdr pane` / `herdr tab` 等命令组不带子命令直接跑，就是用法手册。
- 前置：`test "${HERDR_ENV:-}" = 1`；**不要跑裸 `herdr`**（会 attach TUI）。
- 两条最常见错误：① 给 `agent prompt` 加 `--wait` → block 当前会话；② 忘了 poll —— 用 `herdr agent list` 看 state（`done` = 干完你还没读；`blocked` = 在等你回答）。
- **与 intercom 分工（控制面 / 消息面）**：herdr-dispatch 管生命周期（spawn、pane 摆位、job store、collect 归档）；intercom 管内容（回报、批复、决策、取消）。
  - 同一任务只走一条通路投递，勿双投。
  - 任务书写死一行：「做完 intercom send 回 captain（短 id 用 `intercom list` 现取）」。回报自动注入并唤醒 captain —— 收结果靠推送，不轮询；`collect` 只做 pane 转储归档。
  - 后续交互（追问、改稿、批复）用 `intercom send` 发同一会话短 id，复用长驻 pane 上下文；短任务的频道确认并进任务书，不单发（快 worker 可能已干完）。
  - `watch` 可省：fleet 快照依赖 herdr（出过 1ms 超时故障）；`intercom list` 能看 live 状态（thinking / tool:xxx）与 pane 位置，足以补位。


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
