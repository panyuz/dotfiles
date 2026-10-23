---
name: dotfiles
description: "管理 ~/Documents/github/dotfiles 仓库：macOS 全局配置（ghostty/herdr/pi 及全局 skill）的 git 真源。当用户要求修改全局配置、新增/修改全局 skill、部署/同步 dotfiles、换机恢复环境时使用。"
---

# dotfiles 仓库管理

> 真源：`~/Documents/github/dotfiles`（远程 `git@github.com:panyuz/dotfiles.git`，分支 main）
> 部署位置：`~/.config/*`、`~/.pi/agent/*`、`~/.gemini/antigravity-cli/skills/*` 均为 **symlink** 指向仓库

## 仓库结构

```
dotfiles/
├── mac/                      # macOS 专属配置
│   ├── ghostty/config        # 终端外观/字体/快捷键（symlink 到 ~/.config/ghostty/config）
│   ├── herdr/config.toml     # herdr 主题/快捷键（symlink 到 ~/.config/herdr/config.toml）
│   ├── zsh/zshrc             # 交互式 shell 全部配置（symlink 到 ~/.zshrc；含 eza 颜色、starship init、herdr 标题钩子）
│   ├── starship/starship.toml # 提示符主题（symlink 到 ~/.config/starship.toml，gruvbox-rainbow 预设）
│   ├── pi/agent/AGENTS.md    # pi 全局指令（symlink 到 ~/.pi/agent/AGENTS.md）
│   ├── skills/<name>/        # 全局 skill 真源（目录级 symlink → ~/.pi/agent/skills/ 与 ~/.gemini/antigravity-cli/skills/）
│   └── omp/                  # ⚠️ omp 已弃用（2026-09-18），保留仅作历史参考
│       ├── agent/APPEND_SYSTEM.md  # omp 系统提示（曾 symlink 到 ~/.omp/agent/）
│       ├── agent/extensions/       # omp 用户级 extension 真源
│       └── search-skills-deploy.md # 联网搜索 skill（anysearch/byted-web-search）部署参考
├── win/                       # Windows 占位（install.ps1）
├── shared/                    # 跨平台配置占位
├── install.sh                 # macOS 部署（幂等 symlink + 备份冲突 + 自动循环链接 skills）
├── install.ps1                # Windows 部署骨架
└── .gitignore                 # 排除 *.log/*.sock/session.json/release-notes.json/.plugins.lock/**/models.yml
```

> **2026-09-18 变更**：全局 skill 真源由 `mac/omp/skills/` 迁到 **`mac/skills/`**（名实相符：herdr-dispatch、dotfiles 都不属于 omp），
> 部署方式从「omp 真源 + pi 实体副本」改为 **单一真源 + symlink 双端**；omp 已弃用，install.sh 不再纳管 `~/.omp/*`。

> **2026-10-23 变更**：`herdr-dispatch` 与依赖它的 `herdr-swarm` 仅停用 Pi / agy 部署软链接，`mac/skills/` 源码及未提交改动保留。`install.sh` 跳过这两个名称，避免重建链接。Pi 子任务使用当前会话的 pi-subagents；Herdr 操作用 `herdr --skill` 现取官方正文。

> **2026-10-12 变更**：**herdr skill 停用**（官方正文改 `herdr --skill` 现取，免漂移）；4 个本机经验 references 迁入 `mac/skills/herdr-dispatch/references/local/`（**已于 2026-10-13 删除，见下条**）；新增 **herdr-dispatch** skill（上游 arronKler/herdr-skills v1.8 · copy 安装 + uv shim 入口，见其 `SOURCE.md`）。另：**herdr-watch 扩展停用**（改名 `herdr-watch.ts.retired` 躲开 install.sh 的 `*.ts` 通配，不再链接）—— 功能被 herdr-dispatch 的 `watch` 取代。

> **2026-10-13 变更**：**删除 `mac/skills/herdr-dispatch/references/local/`**（agent-dispatch / pi-interaction / agy-interaction / mcp-config 四个本机笔记）—— 其中「手搓 4 步」写法（`herdr pane split --current`）与上游 SKILL.md 的放置规则（worker 独占新建 tab、never split the captain pane）**相冲突**，留着会误导；全局 `mac/pi/agent/AGENTS.md` 与 skill 的 SKILL.md 头部指向该目录的两处引用同步删除。需查旧笔记时从 git 历史取（`git show <commit>:mac/skills/herdr-dispatch/references/local/agent-dispatch.md`）。

> **2026-10-16 变更**：纳入两个 shell 侧文件：`mac/zsh/zshrc`（≈ 原来的 `~/.zshrc` 全文：别名、eza 颜色、starship init、herdr 标题钩子）与 `mac/starship/starship.toml`（starship 官方 gruvbox-rainbow 预设）。
> **注意：`~/.zshrc` 从此是 symlink**——改 shell 配置要改仓库里的 `mac/zsh/zshrc`，改完新开 shell 生效。当时同时把 Ghostty/herdr 主题从 Rose Pine 换成 Catppuccin Mocha（复刻参考图）。

> **2026-08-21 规则**：omp 等 agent 仅纳管**文本文件**（mcp/skills/append/prompt）；
> `config.yml`、`models.yml` 等本机自维护（真身在 `~/.omp/agent/`，不入库）。

## 关键机制（源码核实的硬事实）

- **pi 用户级 skill 扫描目录 = `~/.pi/agent/skills/`**（`settings.json` 未声明 `skills` 数组，纯自动扫描）。symlink 目录被支持（现役 `dotfiles` 即为 symlink；已退役的 skill 源码不参与部署）。
- **skill 发现是自动目录扫描**：放对目录即自动注册，无需任何声明/注册。
- **pi 加载时机 = 会话启动**：新增/修改 skill 后需**重启 pi 会话**才生效（当前会话有启动时缓存）。
- **`disable-model-invocation: true`**（pi frontmatter 字段）：该 skill 不进系统提示，模型看不见、只能用户 `/skill:<name>` 手动调——用于「必须用户明确点名才用」的 skill（历史上用过：herdr skill；2026-10-12 已停用）。
- pi 忽略未知 frontmatter 字段（如旧 omp 的 `hide: true`），校验宽松；`name` 不要求与目录同名，便于共享目录。
- **agy（Antigravity CLI）全局 skill 目录 = `~/.gemini/antigravity-cli/skills/`**（官方文档核实 2026-09-18；不是 `~/.gemini/config/skills/`——那是 Antigravity 2.0 / IDE 的位，且只认绝对路径、不认 `~`）。symlink 目录被跟随；用 `agy -p "/skills"` 可列出实际生效清单（比问模型可靠——模型可能漏报）。
- **agy 只识 name/description**（官方仅这两个字段）：pi 的 `disable-model-invocation` 在 agy 侧无效，所以非手动类 skill 靠 description 写清触发条件来自律。
- omp 已弃用（2026-09-18）：`~/.omp/agent/*` 不再随 install.sh 更新；`mac/omp/` 目录仅留历史参考与搜索 skill 部署笔记。
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
mkdir -p ~/Documents/github/dotfiles/mac/skills/<name>
# 写 SKILL.md（必须含 name + description frontmatter；description 非空才被加载）
# 若需「只许手动调用」：frontmatter 加 disable-model-invocation: true
# 2) 部署（install.sh 自动循环链接 mac/skills/*，无需改脚本）
~/Documents/github/dotfiles/install.sh
# 3) 提交推送
cd ~/Documents/github/dotfiles && git add -A && git commit -m "skill: 新增 <name>" && git push
```

验证：`readlink ~/.pi/agent/skills/<name>` 指向仓库内路径；重启 pi 会话后 `/skill:<name>` 可解析。
agy 侧：`readlink ~/.gemini/antigravity-cli/skills/<name>` + `agy -p "/skills"` 应在清单里看到（install.sh 已自动分发，无需手工）。

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
