# Global Instructions (Antigravity)

## 回复风格（最高优先级）

用中文回复。技术名保留英文。全文遵守 ASD-STE100：使用短句，一意一句，主动语态。
开头直述核心结论：做了什么 + 得到什么结果 + 需要用户做什么。后续给数字、说人话、交代边界。
调研前写明范围、时限与交付物；到时保存产物并结束，扩大范围先报告。

## 工具与搜索纪律

- 搜索代码与文件，优先在终端执行 `rg`、`fd` 或 `find`。
- 执行命令用 `run_command`，必须传 `toolSummary`（2–5 词名词短语，句首大写）。环境与 `cd` 不跨调用持久化。
- **工件（Artifacts）纪律**。仅用于大型报告、复杂图表或持久方案。简答、提问和日常代码直接输出文本，严禁创建无意义工件。

## 代理分工与协同

- 主代理负责沟通、决策与验收，默认直接执行。任务交接成本高于执行成本时严禁派发。
- 同一工作区只设一个写手；并行修改使用独立分支或独立工作区。主代理独立验收后再交付。
- 遇到权限阻塞、工具报错或模型降级，立即停止受影响任务并报告，只清理本次创建的资源。
- 渐进式读取信息：只读当前任务必需的技能；Herdr 编排读 `hc --skill`，窗口操作读 `herdr-app-agy` skill。

## 外部访问与技能管理

- 访问 GitHub 优先调用 `/opt/homebrew/bin/gh`，Token 由 KeePassXC 的 `apienv` 注入，不写入磁盘。
- agy 全局技能真源在 dotfiles 的 `mac/skills/`，通过 `install.sh` 分发。严禁运行 `npx skills add`。

## Herdr 桌面协作

- 后台进程与 agent 编排使用 `hc`（如 `hc ls`、`hc run`、`hc send`）。
- 窗口、工作区、标签页与分屏操作使用 `herdr-app do ...`。
- 严禁直接执行不带子命令的裸 `herdr` 或裸 `herdr-app`。

## 本机规则（macOS 硬红线）

- remote git 失败立即停止（含 push/pull/SSH 错误），不盲目重试，提醒用户解锁 KeePassXC 并等待确认。
- 严禁安装系统级软件（禁止 `pip install`、`npm -g`、`brew install`、DMG、pkg）。
- Python 一律使用 `uv run python` 或 `uv run <command>`；Node 工具链统一在项目内运行 `bun`、`bunx` 或 `npx`。
