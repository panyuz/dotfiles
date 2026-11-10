---
name: dotfiles
description: "管理 dotfiles 仓库的 Windows 侧真源 win/：Windows 全局配置与全局 skill 的 git 真源。当用户要求修改 Windows 全局配置、新增或修改 Windows 技能、准备部署或换机恢复时使用。"
---

# dotfiles 仓库管理（Windows）

> 仓库：`C:/Users/smart/Documents/github/dotfiles`
> 远程：`https://github.com/panyuz/dotfiles`
> Windows 侧真源：`win/`。macOS 侧真源：`mac/`，mac 专属，不在本技能范围。

## 1. 真源与归属

- Windows 配置写入 `win/`。
- 不改 `mac/`。mac 配置保持 mac 专属。
- `shared/` 只在确认跨平台字节级一致时使用。当前 `shared/` 只有 `.gitkeep`。
- 每个仓库按自己的规则处理分支与文件归属。comtools 有 `win` 分支和自己的目录约定。不要把该规则套到其它仓库。
- 遵守当前仓库和本机适用的分支规则。不自行切换分支，也不用其他命令绕过限制。

## 2. 现状（2026-11-10 核实）

- 克隆时 `win/` 只有 `.gitkeep`。
- 本轮已新增 `win/skills/dotfiles/` 与 `win/skills/herdr-loop/` 两个技能源码。
- 根 `install.ps1` 是部署骨架。它只有 `Link-Config` 函数和注释，没有技能部署表。
- 根 `install.ps1` 末尾无条件打印“部署完成”。该输出不能证明任何技能已部署。
- `win/skills/` 默认不在 Pi 自动扫描目录。当前 `settings.json` 也没有显式配置 skills 路径。不能声称“已自动部署”或“已生效”。

## 3. 工具分工

- 常规文件与 git 命令用 Git Bash（`C:/Users/smart/scoop/apps/git/current/bin/bash.exe`）。
- 注册表、Windows 服务、计划任务、持久化环境变量用 PowerShell。
- shell 路径用正斜杠：`C:/Users/smart/...`。只有 PowerShell 原生命令用反斜杠。
- 不覆盖 `$HOME` 或其它系统变量。
- 新建文件默认 LF、UTF-8 无 BOM。

## 4. Pi 技能部署

已核实的 Pi 路径（Pi 1.5.1）：

- 全局技能目录：`C:/Users/smart/.pi/agent/skills/`。本机的 `dotfiles` 与 `herdr-loop` 按用户要求，通过目录符号链接指向本仓库的 `win/skills/`。
- Agent Skills 目录：`C:/Users/smart/.agents/skills/`。部署前检查同名技能，避免两个扫描位置产生名称冲突。
- 设置文件：`C:/Users/smart/.pi/agent/settings.json`。当前未声明 `skills` 数组。Pi 支持显式 skills 路径，当前没有配置。
- 项目级技能目录包括 `<项目>/.pi/skills/` 与 `<项目>/.agents/skills/`。还需检查项目设置和已加载包中的技能路径。

授权规则：

- 用户已明确授权部署到某目标时，直接执行，不重复确认。
- 只有未授权的新 live 目标才用问题框询问。
- 不自作主张写全局目录。

部署规则：

- 用户在 2026-11-10 明确要求 `dotfiles` 与 `herdr-loop` 使用目录 `SymbolicLink`。这两个技能的真源保留在本仓库 `win/skills/`。
- 全局链接分别为 `~/.pi/agent/skills/dotfiles` 和 `~/.pi/agent/skills/herdr-loop`，目标必须是对应的 Windows 真源目录。
- 用 PowerShell `New-Item -ItemType SymbolicLink` 创建。权限不足时通过正常 UAC 请求管理员执行，不静默改成 junction 或实体副本。
- 正确链接已存在时，直接核对目标与内容，不重复创建。
- 同名普通目录或不同目标链接有冲突时，先识别并备份。备份必须放在所有技能扫描目录之外，不能递归删除链接目标。
- 修改技能时编辑仓库真源。链接内容随真源变化；Pi 当前会话的技能清单和缓存用 `/reload` 更新。
- 其他技能的安装方式仍按当次用户要求和适用规则处理，不将这两个技能的授权扩展到无关目录。
- 源码、链接创建和 Pi 加载状态分开记录。只有验证后才报告对应状态。

步骤与检查见 [references/windows-workflow.md](references/windows-workflow.md)。

## 5. 日常操作

### 新增 Windows 技能

1. 在 `win/skills/<name>/` 建 `SKILL.md`。
2. frontmatter 写 `name` 与 `description`。description 要写清用途和触发时机。
3. 需要用户手动调用时，加 `disable-model-invocation: true`。
4. 需要附带资料时，放同目录 `references/`。主文件用相对链接引用。
5. 验证 frontmatter 与链接。见 [references/windows-workflow.md](references/windows-workflow.md)。
6. 只 `git add` 本次新增的具体文件。

### 修改现有配置

1. 先读目标文件，确认它属于 `win/`。
2. 改完检查 LF 与 BOM。
3. 只提交具体文件，保留已有用户改动。

### 换机恢复

1. `git clone` 本仓库。
2. 按用户指示，将这两个 Windows 技能链接到明确的全局目标，再验证链接。
3. 手动补本机私有文件。密钥、认证、会话、缓存不入库。

## 6. 硬规则

- 密钥、认证、会话、缓存不入库。
- 临时资料落执行项目的 `tmp/`。长期验收文档落该项目允许的路径。
- 只 `git add` 具体文件。不要 `git add -A`。保留已有用户改动。
- 推送、拉取、clone 认证失败立即停。不换 remote、不换协议、不换 key。提示用户检查 KeePassXC。
- 源码与部署状态分开记录。未部署就写未部署，不写“安装已完成”。
