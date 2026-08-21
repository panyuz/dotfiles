---
name: dotfiles
description: "管理 ~/Documents/github/dotfiles 仓库：macOS 全局配置（ghostty/herdr/omp 及全局 skill）的 git 真源。当用户要求修改全局配置、新增/修改全局 skill、部署/同步 dotfiles、换机恢复环境时使用。"
hide: true
---

# dotfiles 仓库管理

> 真源：`~/Documents/github/dotfiles`（远程 `git@github.com:panyuz/dotfiles.git`，分支 main）
> 部署位置：`~/.config/*`、`~/.omp/agent/*` 均为 **symlink** 指向仓库（除 plugins.json 与含密钥/运行时文件本机自维护）

## 仓库结构

```
dotfiles/
├── mac/                      # macOS 专属配置
│   ├── ghostty/config        # 终端外观/字体/快捷键（symlink 到 ~/.config/ghostty/config）
│   ├── herdr/config.toml     # herdr 主题/快捷键（symlink 到 ~/.config/herdr/config.toml）
│   └── omp/
│       ├── agent/APPEND_SYSTEM.md  # omp 系统提示（symlink）
│       ├── agent/extensions/       # omp 用户级 extension 真源（symlink 到 ~/.omp/agent/extensions/）
│       ├── search-skills-deploy.md # 联网搜索 skill（anysearch/byted-web-search）部署参考
│       └── skills/<name>/          # 全局 skill 真源（目录级 symlink 到 ~/.omp/agent/skills/<name>）
├── win/                       # Windows 占位（install.ps1）
├── shared/                    # 跨平台配置占位
├── install.sh                 # macOS 部署（幂等 symlink + 备份冲突 + 自动循环链接 skills）
├── install.ps1                # Windows 部署骨架
└── .gitignore                 # 排除 *.log/*.sock/session.json/release-notes.json/.plugins.lock/**/models.yml
```

> **2026-08-21 规则**：omp 等 agent 仅纳管**文本文件**（mcp/skills/append/prompt）；
> `config.yml`、`models.yml` 等本机自维护（真身在 `~/.omp/agent/`，不入库）。

## 关键机制（源码核实的硬事实）

- **omp 用户级 skill 扫描目录 = `~/.omp/agent/skills/`**（不是 `~/.omp/skills/`！2026-08-12 源码核实 builtin.ts）。symlink 目录被支持（`isDirectory() || isSymbolicLink()` 均放行）。
- **skill 发现是自动目录扫描**：放对目录即自动注册，config.yml 无需任何声明/注册。
- **omp 加载时机 = 会话启动**：新增/修改 skill 后需**重启 omp 会话**才生效（当前会话有启动时缓存）。
- herdr 的 `plugins.json` 是插件管理器回写状态文件（含本机绝对路径）——**不纳管**，留在 `~/.config/herdr/plugins.json` 本机自维护。
- `~/.omp/agent/config.yml`、`~/.omp/agent/models.yml` 本机自维护（可能含密钥/本机偏好）——**不入库**。

## 日常操作

### 1. 修改现有配置（ghostty/herdr/omp 或任意 skill）

编辑 symlink 指向的文件即编辑真源（`~/.config/ghostty/config` ≡ `dotfiles/mac/ghostty/config`）。改完同步：

```bash
cd ~/Documents/github/dotfiles && git add -A && git commit -m "<类别>: <改动描述>" && git push
```

提交信息惯例：`mac: ...`（配置）/ `skill: ...`（skill 内容）。

### 2. 新增一个全局 skill

```bash
# 1) 真源建在仓库
mkdir -p ~/Documents/github/dotfiles/mac/omp/skills/<name>
# 写 SKILL.md（必须含 name + description frontmatter——native provider requireDescription）
# 2) 部署（install.sh 自动循环链接 skills 目录，无需改脚本）
~/Documents/github/dotfiles/install.sh
# 3) 提交推送
cd ~/Documents/github/dotfiles && git add -A && git commit -m "skill: 新增 <name>" && git push
```

验证：`ls ~/.omp/agent/skills/<name>/SKILL.md`；重启 omp 会话后 `skill://<name>` 可解析。

### 3. 新增某工具的配置

真源入 `dotfiles/mac/<tool>/` → `install.sh` 的 `link` 表加一行 → 跑 `install.sh` → 提交推送。注意遵循排除清单（密钥/运行时产物不入库）。

### 4. 换机/重装恢复

```bash
git clone git@github.com:panyuz/dotfiles.git && cd dotfiles && ./install.sh
# 然后手动补：~/.omp/agent/config.yml、models.yml 等本机文件（从旧机拷贝）
# herdr 插件需重新安装（plugins.json 本机自维护）
```

## 硬规则

- 🔴 **密钥永不入库**：apiKey/token/secret 一律模板化或排除；提交前跑密钥扫描：`grep -rE 'sk-[a-z0-9]{20,}|apiKey: *["'"']?sk-' .`（有输出则停下）
- 🔴 运行时产物不入库：`*.log`、`*.sock`、`session.json`、`release-notes.json`、`.plugins.lock`、`**/models.yml`（.gitignore 已含）
- 🔴 symlink 目标必须指向仓库内路径（`readlink` 可验证）；发现指向仓库外 → 用 `install.sh` 重建
- 🟡 install.sh 幂等：冲突文件备份为 `.bak.<时间戳>`；悬空 symlink 先清后建（-e 对悬空链接为 false）
- 🟡 双平台：win 侧配置进 `win/`（install.ps1 部署），跨平台通用配置进 `shared/`（暂空，确认字节级一致后再提升）
