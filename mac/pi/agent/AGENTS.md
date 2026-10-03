# 全局指令 Global Instructions

## Response Style（最高优先，适用于所有项目）

Write your answers in Chinese. You can use English words for technical names. Keep the language easy to read. The whole answer must also obey the ASD-STE100 standard.

## Tool Use（工具使用）

- 搜索时，先用内置的 `grep` 或 `find` 工具。一次调用可以给多个词（OR 关系）。内置工具不能完成的操作用 bash。
- 读文件时，用 `read` 的 `offset` 和 `limit`，只读命中位置附近。已知的文件在工作区之外时，直接用 `read` 加绝对路径。

## herdr（终端多 agent 并行）

- 用 herdr 之前（派发 agent、轮询 state、开关 panel），先读它 skill 的 `references/`，取本机实战经验：`agent-dispatch.md`（派发节奏、state 语义、常见错误）、`pi-interaction.md`（运行 pi）、`agy-interaction.md`（运行 agy）、`mcp-config.md`。官方的 `SKILL.md` 只给命令约定，**不得修改**。要刷新时运行 `herdr --skill`。
- 两个最常见的错误：
  1. 派发 `agent prompt` 时加 `--wait`。这会让当前会话卡住，等它完成。
  2. 忘记轮询。用 `herdr agent list` 看 state：`done` = 已完成、你还没看；`blocked` = agent 在等你的回答。

## External Search (GitHub)

- 分工：检索用 `gh`，深读用 `fetch_content`。
- `gh` 已安装（Homebrew，`/opt/homebrew/bin/gh`）。**不得重装**。
- 认证：包装器 `~/.pi/agent/bin/gh` 在运行时从 KeePassXC 的 `apienv` 库「github」条目取 `GH_TOKEN`。token 不写入磁盘。在 pi 会话里，`gh` 直接命中这个包装器。私有仓库和高限额必须带 token。
- 搜索：用 `gh search repos|code|issues|commits`。可以按 star、语言、更新时间筛选。它支持代码级搜索。
- 深读：用 `fetch_content`。它在内部调用 `gh`，完成 `gh repo clone`、PR 解析、issue 解析。没有 `gh` 时，它退回 `git clone`。这时读不了私有仓库。
- 限额：core = 5000/h；search = 30/min；code search = 10/min。未认证时分别是 60/h、10/min、不可用。
- 换 token：GitHub 发新 token 后，只更新 KeePassXC 的「github」条目。包装器不用改。

## Skill Installation（Skill 安装）

- 一律用**复制安装**。从官方来源（GitHub 仓库或官方 skill 市场）取 skill 目录。复制到目标 skill 目录（例如 `~/.pi/agent/skills/<name>`）。然后按需要做本机本地化（KeePassXC key 注入、`uv` 依赖声明）。方法与案例见 dotfiles 的 `mac/omp/search-skills-deploy.md`。
- **不得用 `npx skills add`**。它向本机检测到的多个 agent 目录复制文件，且不带本机补丁。`skills remove -g` 还会误删主部署。

## Local Rules (macOS)

- git 远程操作失败时（push、pull、SSH 权限类）：立即停止。不得重试。不得换 remote、不得换协议、不得试其它 SSH key。提醒用户解锁 KeePassXC，然后等确认。
- 不得做系统级安装（`pip install`、`npm -g`、`brew install` 等）。Python 一律用 `uv`，包括 `-c` 单行和 heredoc。不得用系统 python3。项目 Python 环境由 `uv` 管控。Node 用 `bun`、`bunx` 或 `npx`，在项目内执行。查看 JSON 时先用 `jq` 或内置 `read` 工具。需要 Python 时才用 `uv`。
