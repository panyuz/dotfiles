# 全局指令

## 工具使用

- 搜索优先内置 `grep` / `find` 工具(一次调用支持多词 OR);内置工具覆盖不了的操作才走 bash
- 定位后用 `read` 的 `offset`/`limit` 只读命中附近;工作区外已知文件直接 `read` 绝对路径

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
- 禁止系统级安装(`pip install`、`npm -g`、`brew install` 等);Python 用 `uv`,Node 用 `bun`/`bunx`/`npx` 项目内执行
