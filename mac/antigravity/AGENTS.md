# Global Instructions (Antigravity)

## 回复风格（最高优先级，适用所有项目）

用中文回复。技术名保留英文。全文遵守 ASD-STE100：使用短句。每句只表达一个意思。使用主动语态。

开头一句直述核心结论：做了什么 + 得到什么结果 + 需要用户做什么。后续陈述给数字、说人话、交代边界。

调研前写明范围、时限和交付物。到时保存产物并结束。扩大范围前先报告。

## 工具使用

- 读文件用 `read_file`。读取 workspace 外的文件使用绝对路径。大文件用 `StartLine` 和 `EndLine` 分段读取。
- 改文件用 `edit_file`。精确匹配目标字符串，执行单段代码替换。保留已有注释与文档。
- 建文件用 `write_file`。非 artifact 文件严禁添加 `ArtifactMetadata`。
- 执行命令用 `run_command`。仅在专用文件工具无法完成任务时调用。同步任务设置 `WaitMsBeforeAsync` 为 5000–10000。严禁使用 shell sleep 轮询。
- 搜索优先在终端执行 `rg`、`fd`、`find` 或 `grep`。
- **工件（Artifacts）纪律**。仅用于需要持久展示的大型报告、多步骤方案或复杂图表。日常简答、代码段、提问和沟通直接输出文本，严禁创建无意义工件。

## 代理分工与响应式协同

主代理负责用户沟通、决策、综合与最终验收，默认直接执行。用户或技能明确授权后，可派发子任务。

- **子代理派发**。使用 `invoke_subagent`。明确指定 `Role`、`TypeName` 与任务 `Prompt`。默认模型继承主代理（`Model: "inherit"`）。
- **响应式唤醒**。子代理启动后等待系统消息推送。严禁在主代理中循环查询状态或轮询等待。
- **通用边界**。子代理默认不得再派发。同一工作区只设一个写手。并行修改使用独立分支或独立工作区。主代理独立核实与验收产物后再交付。
- **失败与阻断**。遇到权限阻塞或工具失败，立即停止受影响任务并报告。不盲目重试，不静默更换模型，不绕过安全检查。只清理本次创建且已验证的资源。

只读取当前任务所需的技能与参考文档。Herdr 编排读 `hc --skill`；窗口与布局操作读 `herdr-app-agy` skill。编译、下载和测试直接运行程序。

## GitHub 检索

- 搜索用 `gh search repos|code|issues|commits`。按 star、language 和更新时间筛选。
- `gh` 位于 `/opt/homebrew/bin/gh`。不得重装。
- 会话从 KeePassXC 的 `apienv` 库读取 `github` 条目并注入 `GH_TOKEN`。Token 不写入磁盘。访问 private repo 和使用高配额必须带 token。
- 认证限额：core 5000/h、search 30/min、code search 10/min。未认证限额：core 60/h、search 10/min；code search 不可用。
- 更换 token 时，只更新 KeePassXC 的 `github` 条目。

## 技能与全局配置管理

- agy 全局技能安装目录为 `~/.gemini/antigravity-cli/skills/`。所有技能由 dotfiles 仓库的 `mac/skills/` 统一管理并通过 symlink 分发。
- 严禁运行 `npx skills add` 或 `skills remove -g`。
- 新增全局技能在 dotfiles 的 `mac/skills/<name>/` 编写 `SKILL.md`（必须包含 `name` 和 `description`），随后运行 `dotfiles/install.sh` 自动链接。
- agy 仅读取 frontmatter 中的 `name` 与 `description`。触发条件与限制写在 `description` 中。

## Herdr 桌面与会话协作

- 终端与后台 agent 进程管理使用 `hc`（如 `hc ls`、`hc run`、`hc send`）。
- 窗口、工作区、标签页与分屏操作使用 `herdr-app do ...`（如 `herdr-app do tab.rename`）。
- 严禁直接执行不带子命令的裸 `herdr` 或裸 `herdr-app`。

## 本机规则（macOS 硬红线）

- remote git 操作失败时立即停止，包括 push、pull 和 SSH 权限错误。不得重试，不得更换 remote、protocol 或 SSH key。提醒用户解锁 KeePassXC，然后等待确认。
- 不得向系统安装任何软件或依赖包。严禁 `pip install`、`npm -g`、`brew install`、DMG 或 pkg 安装。
- Python 一律使用 `uv run python` 或 `uv run <command>`。严禁直接调用系统 `python` 或 `python3`。项目 Python 依赖由 `uv` 管理。
- Node 工具链统一使用 `bun`、`bunx` 或 `npx`，在项目内运行。
