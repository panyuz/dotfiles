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

- 主代理负责用户沟通、目标决策、`TODO.md` 维护与最终交付。收到任务先简短判断三项：能否独立派发、是否需要人看见、是否有并行或隔离收益。短任务和无收益时由主代理直接处理。
- **普通任务授权与后端路由**。存在独立子任务且有隔离、并行或独立验证收益时，主代理可主动派发。无需人实时观看时，默认使用 AGY 原生 `invoke_subagent`（或 `run_workflow`）。在 Rex 环境中需要同屏可见、人工插话或调用 Pi 快速模型（`magpie/auto/deepseek-flash`）时，用 `rex split`（当前 tab 分屏）或 `rex window new`（新 tab）调动交互式 `pi`（或 `agy`）。
- **长期任务路由（`rex-loop-agy`）**。仅在用户显式调用 `rex-loop-agy` 时启动 loop，严禁自发自动进入。启用时必须先核实当前处于 Rex 环境（`$REX_SESSION` 与 `$REX_BLOCK`），并与用户确认任务边界与派发方案后再派发。loop 的状态记录、分级验证与完成判定按技能正文执行，不在本文件复制。
- **通用边界与失败清理**。子代理默认不得再派发。同一工作区只设一个写手；并行修改使用 `workspace: "share"|"branch"` 或独立工作区。核实实际模型、启动和首任务送达。普通任务由主代理综合证据并验收；loop 按对应技能的分级验证执行。遇到权限阻塞、工具报错或模型降级，立即停止受影响任务并报告，不静默换后端或模型，只清理本次创建且已验收的资源。
- **渐进式读取**。只读当前任务必需的技能；Rex 操作读 `rex` skill（或执行 `rex __internal skill`），Rex 长任务读 `rex-loop-agy` skill；Herdr 编排读 `hc --skill`，Herdr 窗口读 `herdr-app-agy` skill。

## 外部访问与技能管理

- 访问 GitHub 优先调用 `/opt/homebrew/bin/gh`，Token 由 KeePassXC 的 `apienv` 注入，不写入磁盘。
- agy 全局技能真源在 dotfiles 的 `mac/skills/`，通过 `install.sh` 分发。严禁运行 `npx skills add`。

## 终端底座协作（Rex 与 Herdr）

- **先确认终端环境**：执行终端操作、分屏或命名前，先检查环境变量 `$REX_SESSION`（Rex 环境）与 `$HC_TERMINAL_ID`（Herdr 环境）。
- **Rex 环境协作与调动 Pi**：用 `rex whoami --json`、`rex block ls -s "$REX_SESSION" --json`、`rex session inspect "$REX_SESSION" --json` 核对完整 `session_id`、`window_id` 与 `block_id`。用 `rex split` 或 `rex window new` 调动交互式 `pi`（`-- pi --name "🐙sub｜<职责>" --model magpie/auto/deepseek-flash --thinking high "<首任务>"`）或 `agy`。用 `rex capture` 检查终端输出与输入框状态，用 `rex send` 加 `rex send-key enter` 发送指令或回报。
- **Herdr 环境协作**：后台进程与 agent 编排使用 `hc`（如 `hc ls`、`hc run`、`hc send`）；窗口、工作区、标签页与分屏使用 `herdr-app do ...`。严禁直接执行不带子命令的裸 `herdr` 或裸 `herdr-app`。
- **Session 与 Tab 命名**：执行任何任务前，必须显式为当前会话（`/rename <中文名>`）与所在终端的专属 Tab 命名（中文 + Emoji 前缀，共享 Tab 保留主任务名）。在 Rex 中执行 `rex window rename -s "$REX_SESSION" <window_id> "🔍 任务中文名"`；在 Herdr 中执行 `herdr-app do tab.rename --name "🔍 任务中文名"`。

## 本机规则（macOS 硬红线）

- remote git 失败立即停止（含 push/pull/SSH 错误），不盲目重试，提醒用户解锁 KeePassXC 并等待确认。
- 严禁安装系统级软件（禁止 `pip install`、`npm -g`、`brew install`、DMG、pkg）。
- Python 一律使用 `uv run python` 或 `uv run <command>`；Node 工具链统一在项目内运行 `bun`、`bunx` 或 `npx`。
