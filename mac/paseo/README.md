# mac/paseo — 本机配置备份与调研记录

## 备份（`backup/`）

- 内容 = 2026-10-16 的原样快照：`pi/`（settings、扩展）与 `antigravity/`（settings、hooks、守卫脚本）。
- **仅作参考与恢复用，不自动覆盖本机文件。** 本目录不提供一键安装或部署脚本。
- 程序（Paseo、pi、Antigravity CLI）的全局安装与升级由用户本人操作。
- 运行配置真源在本机、不入库：`~/.paseo/config.json`、`~/.pi/agent/`、`~/.gemini/`。

## 当前模式（最小）

- Paseo 只作 agent 协调层（包装 pi 等 CLI），不替换 pi 环境。
- pi 的 settings、扩展、安防脚本与全部 skill 软链接由 `install.sh` 和 Herdr/Paseo 各自维护，本目录不接管。
- Herdr 与 Paseo 的运行配置及 hooks 均不改动。

## 调研记录

- `herdr-vs-cmux-research.md`
- `herdr-vs-paseo-research.md`
- `pi-chat-runtime-research.md`
