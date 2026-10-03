# Global Instructions

## Response Style (highest priority; all projects)

Write your answers in Chinese. You can use English words for technical names. Keep the language easy to read. The whole answer must also obey the ASD-STE100 standard.

## Tool Use

- 搜索：先用内置 `grep` 或 `find`。一次调用可以含多个 term（OR logic）。只有内置工具做不到的操作才用 bash。
- 读文件：用 `read` 的 `offset` 和 `limit` 参数，只读 match 附近的内容。已知文件在 workspace 之外时，用 `read` 加绝对路径。

## herdr (terminal multi-agent parallel)

- 用 herdr 之前（dispatch agent、poll state、开/关 panel），先读它 skill 的 `references/`，取本机经验：`agent-dispatch.md`（dispatch 节奏、state 语义、常见错误）、`pi-interaction.md`（run pi）、`agy-interaction.md`（run agy）、`mcp-config.md`。官方 `SKILL.md` 只给 command contract，**不得修改**。要刷新时运行 `herdr --skill`。
- 两个最常见的错误：
  1. 给 `agent prompt` 加 `--wait`。这会让当前会话 block，直到该 agent 完成。
  2. 忘记 poll。用 `herdr agent list` 看 state：`done` = 已完成、你还没读；`blocked` = agent 在等你的回答。

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
