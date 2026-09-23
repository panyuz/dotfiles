# 全局指令

## 回复风格（最高优先，适用于所有项目）

- **一律用通俗易懂的中文回复。** 先说人话，再摆数据。
- **禁止自造名词和行话**：不要用「结构失效·反弹减」「久期敞口」「分母端压制」「认知升维」这类读者看不懂的叫法。
  - 要表达的意思，用大白话直说：例如「上证跌破 3859 点后，等它回涨到 3880 再卖」而不是「短兵线放量收破 → 反弹减仓」。
  - 非用不可的专业词（如「久期」「净值」「MA60」）→ **后面立即用一句大白话解释**，不允许只丢词。
  - 自造缩写（自创英文缩写、拼音首字母、内部黑话）→ **一律禁止**。
- **数据要给具体数字**：不说「接近回本线」，要说「净值涨到 1.51 以上」。
- **用户问「到底多少」→ 直接给数字表**，不要先讲原理、不要先讲分歧、不要堆条件分支。
- **不要用表格堆砌代替回答**：表格是辅助，开头必须有一段大白话说结论。
- 不确定 / 有多个口径 → 明说「有两个口径，分别是…，我建议用 X」，不要让用户自己拼。

## 工具使用

- 搜索优先内置 `grep` / `find` 工具(一次调用支持多词 OR);内置工具覆盖不了的操作才走 bash
- 定位后用 `read` 的 `offset`/`limit` 只读命中附近;工作区外已知文件直接 `read` 绝对路径

## herdr（终端多 agent 并行）

- **动手用 herdr 前（派发 agent / 轮询状态 / 开关 panel）先去它 skill 的 `references/` 查本机实战经验**：`~/.pi/agent/skills/herdr/references/agent-dispatch.md`（派发节奏、状态语义、坑单）、`pi-interaction.md`（跑 pi）、`agy-interaction.md`（跑 agy）、`mcp-config.md`。官方 `SKILL.md` 只给命令契约，**保持不改**（随时可用 `herdr --skill` 刷新）。
- 两条最容易踩的：**派发 `agent prompt` 不加 `--wait`**（会卡住当前会话）；回头用 `herdr agent list` 轮询（`done`=干完未看、`blocked`=在等你回话）。

## 外部检索(GitHub)

- `gh` 与 pi-web-access 分工：**检索走 gh、深读走 fetch_content**；gh 已装（Homebrew `/opt/homebrew/bin/gh`，无需重装）
- 认证：包装器 `~/.pi/agent/bin/gh` 运行时从 KeePassXC `apienv` 库「github」条目注入 `GH_TOKEN`（不落盘）；pi 会话内 `gh` 直接命中该包装器，需带 token 才能用私有仓库与高限额
- 搜索：`gh search repos|code|issues|commits`（可按 star/语言/更新时间筛选，支持代码级搜索）
- 深读：`fetch_content`（pi-web-access 内部调 gh：`gh repo clone` / PR / issue 解析；无 gh 时退回 `git clone` 且读不了私有仓库）
- 限额：core 5000/h、search 30/min、code search 10/min（未认证分别仅 60/h、10/min、不可用）
- 换 token：GitHub 重发 → 只更新 KeePassXC「github」条目，包装器无需改动

## Skill 安装

- 一律**复制安装**：从官方源（GitHub 仓库 / 官方 skill 市场）取 skill 目录，复制到目标 skill 目录（如 `~/.pi/agent/skills/<name>`），再按需做本机本地化（KeePassXC 密钥注入、uv 依赖声明等）；方法与案例见 dotfiles `mac/omp/search-skills-deploy.md`
- **不用 `npx skills add`**：会向本机检测到的多个 agent 目录复制、不带本机补丁，`skills remove -g` 还会误伤主部署

## 本机规则(macOS)

- git 远程操作失败(push/pull,SSH 权限类):立即停止,不重试、不换 remote/协议、不试其它 SSH key;提醒解锁 KeePassXC 并等确认
- 禁止系统级安装(`pip install`、`npm -g`、`brew install` 等);Python 一律用 `uv`（含 `-c` 单行与 heredoc——**禁用系统 python3**，项目 Python 环境由 uv 管控），Node 用 `bun`/`bunx`/`npx` 项目内执行;查看 JSON 优先用 `jq`（或内置 read 工具），需要 Python 才动用 uv
