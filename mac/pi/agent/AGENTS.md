# Global Instructions

## Response Style (highest priority; all projects)

回复用中文，技术名可保留英文。全篇遵守 ASD-STE100 标准：短句、一义一句、主动语态。

调研先定范围与时限；到时保存已有产物并收尾。范围要扩大时先报告。

## Tool Use

- 搜索：先用 `grep` 或 `find`（fff 插件接管：frecency 排序、模糊匹配）。一次调用可含多个 term（OR）。
- 读文件：用 `read` 的 `offset`/`limit`，只读 match 附近。已知文件在 workspace 之外时用绝对路径。
- 只有 `grep`/`find`/`read` 做不到时才用 `bash`。

## 子任务 / 并行任务

- 主代理使用高成本模型时，优先将边界清楚的检索、实现和验证交给低成本子代理。主代理负责拆分、决策和验收。用户明确指定执行方式时，按要求执行。
- 简短回答、即时判断，以及交接成本高于执行成本的操作，由主代理直接完成。需要反复同步背景的工作不要强行拆分。
- 独立分支可并行处理；有依赖的步骤顺序执行。按上下文和交付边界拆分，不为角色名称增加任务层级。
- 不默认追加审查或汇总子任务。仅在需要独立判断、整合多份结果，或验证重要改动时增加。
- 任务书明确允许范围、禁止事项、时限和交付物。到时保存已有产物并收尾，记录改动、验证结果、未完成项和证据路径。

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
