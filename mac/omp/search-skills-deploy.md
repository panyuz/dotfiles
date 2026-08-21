# 联网搜索 Skill 部署参考

> 真源仓库：`~/Documents/github/dotfiles`。本文档记录两个联网搜索 skill 的来源、安装、密钥、运行时配置与验证步骤，供换机/重装/迁移时按此部署。
> **密钥永不入库**：本文档一律使用 `<YOUR_KEY>` 占位，实际密钥放各 skill 目录本机自维护的 `.env` / 环境变量。

## 部署清单（换机后按序执行）

1. 安装 anysearch（见 §1）→ 配置 key → 写 `runtime.conf` → 跑 `doc`/`search` 验证
2. 安装 byted-web-search（见 §2）→ 配置 `WEB_SEARCH_API_KEY` → 跑 `search` 验证
3. 放对 skill 目录后重启 omp 会话，`skill://anysearch` / `skill://byted-web-search` 可解析

---

## 1. anysearch

### 来源

- GitHub：https://github.com/anysearch-ai/anysearch-skill
- 当前版本：v2.1.0（锁定 tag 下载；最新改动可用 `main` 分支 zip）
- 官方文档（API）：https://api.anysearch.com

### 安装（OMP）

```bash
# 下载锁定 release，替换 v2.1.0 为最新 tag
curl -L -o anysearch-skill.zip https://github.com/anysearch-ai/anysearch-skill/archive/refs/tags/v2.1.0.zip
unzip anysearch-skill.zip

# 移到 skill 目录，重命名为 anysearch
mv anysearch-skill-2.1.0 <agent_skill_dir>/anysearch
# OMP 项目级：.omp/skills/anysearch
# OMP 用户级：~/.omp/agent/skills/anysearch
# 共享位置（多 agent 共读）：~/.agents/skills/anysearch
```

### API Key

- 获取：https://anysearch.com/console/api-keys （可匿名使用，额度低；注册后额度高）
- 优先级：`--api_key` CLI flag > `.env`（`ANYSEARCH_API_KEY`）> 环境变量 > 匿名
- 配置：skill 根目录建 `.env`：`ANYSEARCH_API_KEY=<YOUR_KEY>`
- 一键注册：`POST https://api.anysearch.com/v1/auth/email/register`，body `{"email": "you@example.com"}`，返回一次性明文 key（需用户真实邮箱收密码）

### runtime.conf（推荐运行时固化）

`<skill_dir>/runtime.conf`，Agent 加载 skill 时读取，命中则跳过平台探测直接使用：

```
Runtime: Node.js
Command: node <skill_dir>/scripts/anysearch_cli.js
```

> 当前本机选用 Node.js（无第三方依赖，内置 `https`）。若用 Python 需 `requests` 库。
> `runtime.conf` 缺失/损坏时回退到 SKILL.md 的 Platform Detection（Python > Node.js > Shell）。

### 验证

```bash
node <skill_dir>/scripts/anysearch_cli.js doc          # 探测 CLI，确认无报错
node <skill_dir>/scripts/anysearch_cli.js search "hello world" --max_results 1
# 成功返回 JSON 即连通
```

### 文件结构（关键项）

```
anysearch/
├── SKILL.md              # Agent 运行时指令
├── .env                  # API key（gitignored，本机自维护）
├── runtime.conf          # 运行时偏好（gitignored）
├── runtime.conf.example
├── .env.example
├── SECURITY.md / TEST_PLAN.md / LICENSE / NOTICE
└── scripts/
    ├── anysearch_cli.py / .js / .ps1 / .sh   # 多平台 CLI
    ├── generate.py
    └── shared/           # constants.json + doc_spec.md（CLI 共享真源）
```

---

## 2. byted-web-search

### 来源

- GitHub：https://github.com/bytedance/agentkit-samples/tree/main/skills/byted-web-search
- 当前版本：v1.3.8
- 官方文档：https://www.volcengine.com/docs/87772/2272953
- 安装（openclaw 系）：`npx skills add https://skills.volces.com/skills/bytedance/agentkit-samples -s byted-web-search --agent openclaw`
- 或直接把本目录放入 Agent skill 目录

### API Key（两种用户）

**个人用户**：
1. https://console.volcengine.com/search-infinity/web-search → 开通
2. https://console.volcengine.com/search-infinity/api-key → 创建 API Key

**Agent Plan 用户（两步，顺序不能颠倒）**：
1. 先配 Harness：https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=agentPlan → 「配置 Harness」→ 开通「联网搜索/豆包搜索」
2. 再复制 Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D

### 凭证配置

- 环境变量：`WEB_SEARCH_API_KEY=<YOUR_KEY>`
- 本地 `.env`：skill 根目录 `WEB_SEARCH_API_KEY=<YOUR_KEY>`
- 命令行：`--api-key <YOUR_KEY>`（优先级最高）
- 亦可：`VOLCENGINE_ACCESS_KEY` + `VOLCENGINE_SECRET_KEY`（AK/SK，可选）
- 免费额度：个人每月 500 次（2026-07-01 起各开通方式共享，次月 1 日重置）

### 用法

```bash
# 在 skill 根目录（或脚本绝对路径）
uv run python scripts/web_search.py "搜索词" [--count 10] [--type web|image] [--time-range OneDay] [--auth-level 1] [--query-rewrite]
```

### 验证

```bash
uv run python scripts/web_search.py "北京今日天气" --api-key "<YOUR_KEY>"
```

### 文件结构（关键项）

```
byted-web-search/
├── SKILL.md              # Agent 运行时指令
├── README.md / LICENSE
├── scripts/web_search.py
└── references/
    ├── setup-guide.md    # 开通与配置
    ├── quick-start.md    # 快速开通与迷路兜底
    └── troubleshooting.md# 错误码说明
```

---

## 3. 本机实际部署位置（现状）

| skill | 目录 |
|---|---|
| anysearch | `~/Documents/github/INVEST/.omp/skills/anysearch` |
| byted-web-search | `~/Documents/github/INVEST/.omp/skills/byted-web-search` |

> 当前按项目级部署在 INVEST 项目内。若需全局（跨项目）共享，改放 `~/.omp/agent/skills/<name>`（omp 用户级扫描目录），放对目录即自动注册，无需改 config.yml。

## 4. 硬规则

- 🔴 密钥永不入库：`.env`、API key、token 一律占位/排除，提交前跑 `grep -rE 'sk-[a-z0-9]{20,}|as_sk_[a-z0-9]{20,}|WEB_SEARCH_API_KEY=.{8,}' .`（有输出则停下）
- 🔴 `runtime.conf`、`.env` 属本机自维护产物（含本机路径/密钥），不入 git
- 🟡 源仓库版本升级后，重新下载 tag 覆盖 skill 目录，重写 `runtime.conf`

### 密钥真源（KeePassXC）

所有 API key 统一存于 KeePassXC 数据库（keyfile 同目录解锁）：
- 路径：`/Users/panyu/Library/CloudStorage/OneDrive-个人/100Archive/100dataapp/pass/apienv/envapi.kdbx`
- keyfile：`/Users/panyu/Library/CloudStorage/OneDrive-个人/100Archive/100dataapp/pass/apienv/envapi.key`
- 条目：`anysearch`（`ANYSEARCH_API_KEY`）、`byted-web-search`（`WEB_SEARCH_API_KEY`）
- 数据库为 **keyfile-only**（`--no-password --key-file`），KDBX 4 格式（keepassxc-cli 2.7.12 原生支持）

### 动态取 key（无需明文）

两个 skill 的脚本已内置 KDBX fallback：`.env`/环境变量未提供 key 时，直接用 keepassxc-cli 绝对路径从 kdbx 读取条目 Password，注入环境变量。**不落明文 `.env`**。

- keepassxc-cli：`/Applications/KeePassXC.app/Contents/MacOS/keepassxc-cli`
- 读取命令：`<cli> show --no-password --key-file <keyfile> -s <db> <entry>`，解析 `Password:` 行
- anysearch（Node，用项目内 bun 运行）：`loadKeyFromKdbx()` 在 `anysearch_cli.js`
- byted（Python）：`_get_api_key()` 在 `web_search.py`

> 换机时改两个脚本内的 `KEEPASSXC_CLI` / `KDBX` / `KDBX_KEYFILE` 绝对路径，key 仍由 kdbx 提供，不依赖 git 存密钥。
