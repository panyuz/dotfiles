# Global Instructions

## 回复风格（最高优先级，适用所有项目）

用中文回复。技术名可保留英文。全文遵守 ASD-STE100：使用短句。每句只表达一个意思。使用主动语态。

调研前写明范围、时限和交付物。到时保存产物并结束。扩大范围前先报告。

## 工具使用

- 本地文件搜索先用 `grep` 或 `find`。这两个工具由 fff 提供，支持 frecency 排序和模糊匹配。一次调用可含多个 term（OR）。
- 用 `read` 的 `offset` 和 `limit` 读取匹配位置。读取 workspace 外的文件时使用绝对路径。
- `grep`、`find` 和 `read` 无法完成任务时，才用 `bash`。

## 代理分工与渐进式发现

主代理负责用户沟通、综合和最终验收，默认直接执行。用户、任务书或用户已调用的技能明确授权后，可派发子任务。派发不扩大目标或操作权限。

- **普通子任务。** 使用 pi-subagents。派发前读取其 skill，按需查 guide。
- **长期任务。** 仅在用户手动调用 loop 技能后，按该技能执行分工与跟踪流程。
- **通用边界。** 子代理默认不得再派发。同一工作区只设一个写手。并行写入使用独立工作区。核实实际模型、启动和首任务送达。主代理读取产物，独立验收后再交付。
- **失败与清理。** 失败或权限阻塞时，停止受影响任务并报告。不盲目重派，不静默更换模型或启动路径，不绕过权限。只清理本次创建且已验收的资源。

只读取当前任务所需的 skill、工具说明和官方手册。Rex 操作读 `rex` skill；Herdr 编排读 `hc --skill`，窗口和布局读 `herdr-app --skill`。编译、下载和测试可直接运行程序。

## Herdr-app 内命名

仅在 Herdr-app 环境内执行。先用 `herdr-app ls` 核对当前 `HC_TERMINAL_ID`、标签页 ID 和子终端。

- 主代理与子代理的会话显示名使用“emoji + 任务概要”。新建 Pi 会话用 `pi --name "📊 岗位入库"`；已有会话用 `/name 📊 岗位入库`。
- 新建 Herdr 终端时，`hc run --name` 使用唯一的 1–32 位 `a-z`、`0-9`、`.`、`_`、`-`。以字母或数字开头，避开 `t7` 等终端 ID 格式。例如 `jobs-import-1`。
- 对主终端和子终端执行 `hc label <终端ID> "where=📊 岗位入库"`，按各自任务填写名称。
- 已有标签页执行 `herdr-app do tab.rename --id <标签页ID> --name "📊 岗位入库"`。只改对应标签页，不为命名新建标签页。共享标签页保留主任务名。
- 用 `hc get <终端ID>` 和 `herdr-app ls` 核对结果。任务变化时更新会话显示名、任务标签和对应标签页名。
- 保留已有终端 ID 和技术名，不为改名重建代理。通信使用终端 ID；远程使用完整地址。

## GitHub 检索

- 搜索用 `gh search repos|code|issues|commits`。可按 star、language 和更新时间筛选。
- `gh` 位于 `/opt/homebrew/bin/gh`。不得重装。
- pi 会话中的 `gh` wrapper 从 KeePassXC 的 `apienv` 库读取 `github` 条目并注入 `GH_TOKEN`。Token 不写入磁盘。访问 private repo 和使用较高 rate limit 需要 token。
- 认证限额：core 5000/h、search 30/min、code search 10/min。未认证限额：core 60/h、search 10/min；code search 不可用。
- 读取 repo、PR 和 issue 正文用 `fetch_content`。它使用 `gh` 克隆或解析 GitHub 内容。没有 `gh` 时，它回退到 `git clone`，无法读取 private repo。
- 更换 token 时，只更新 KeePassXC 的 `github` 条目。

## 技能安装

- 安装技能一律从官方 GitHub repo 或官方技能市场复制技能目录到目标目录，例如 `~/.pi/agent/skills/<name>`。按需适配 KeePassXC 密钥注入和 `uv` 依赖。方法见 dotfiles 的 `mac/omp/search-skills-deploy.md`。
- 不用 `npx skills add` 或 `skills remove -g`。前者会复制到多个 agent 目录且不带本机补丁；后者可能删除主部署。

## 本机规则（macOS）

- remote git 操作失败时立即停止，包括 push、pull 和 SSH 权限错误。不得重试，不得换 remote、protocol 或 SSH key。提醒用户解锁 KeePassXC，然后等待确认。
- 不得安装系统级软件，包括 `pip install`、`npm -g` 和 `brew install`。Python 只用 `uv`，包括 `-c` 和 heredoc。不得用系统 `python3`。项目 Python 环境由 `uv` 管理。
- Node 工具链用 `bun`、`bunx` 或 `npx`。在项目内运行。
