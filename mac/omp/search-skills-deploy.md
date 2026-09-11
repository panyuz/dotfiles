# 联网信源工具 部署 / 升级参考

> 真源仓库：`~/Documents/github/dotfiles`。本文档讲**四个联网信源工具的部署、升级与换机恢复**，供换机/重装/迁移时按此重建。不逐条复刻 skill 内部文件，重思路、轻细节。
> **密钥永不入库**：真实 key 一律存 KeePassXC（见 §5），本文件只用 `<YOUR_KEY>` 占位。

## 状态速查（2026-09-11 核验）

| # | 工具 | 类型 | 版本 | 安装方式 | 部署位置 | 本机补丁 |
|---|------|------|------|----------|----------|----------|
| 1 | anysearch | skill（Node / `bun`） | **v3.1.1** | 官方源复制 | **两份**：`.pi/` + `.omp/` | **3 处** |
| 2 | byted-web-search | skill（Python / `uv`） | **v1.3.8** | 官方源复制 | **两份**：`~/.pi/agent/` + `.omp/` | **4 处** |
| 3 | twitter-cli | PyPI（`uv tool`） | **0.8.5** | `uv tool install` | `~/.local/share/uv/tools/` | 无 |
| 4 | rdt-cli | PyPI（`uv tool`） | **0.4.1** | `uv tool install` | 同上 | 无 |

> ⚠️ **pi 时代的两份部署**：本项目已从 omp 迁到 pi，两个 skill 各有 pi 与 omp **两份真目录副本**（非 symlink）。
> **升级时必须两份同升**，否则两个会话环境的版本会不一致。两份差异极小且固定：
> - anysearch：`.pi` 份 `SKILL.md` 多一行 `disable-model-invocation: true`；`runtime.conf` 路径不同
> - byted：`.pi` 份 `SKILL.md` 多一行 `disable-model-invocation: true`（同因）

## 部署思路总览

两个 skill 都是"**从官方源拉取 → 放入 skill 目录 → 脚本内嵌 keepassxc-cli 从 kdbx 取 key → 用项目级运行时调用**"。核心三件事：

1. **正确源**：各 skill 从官方仓库/市场拉取（见 §1/§2），不用来历不明的副本
2. **密钥**：不落明文 `.env`，脚本运行时用 `keepassxc-cli` 从 KeePassXC kdbx 动态取（见 §4）
3. **运行时**：一律用项目级命令（`bun`/`bunx`/`uv`），**不用 `npx`、系统 `python`/`node`**（本机禁全局安装依赖，见 §5）

### skill 目录（放对即自动注册）

两个环境都是**扫目录即注册**，无需声明：

| 环境 | 项目级 | 用户级 | 生效时机 |
|------|--------|--------|----------|
| **pi**（现主用） | `<项目>/.pi/skills/<name>` | `~/.pi/agent/skills/<name>` | 会话启动扫描 → 改后需新开会话 |
| **omp**（历史） | `<项目>/.omp/skills/<name>` | `~/.omp/agent/skills/<name>` | 同左 |

> pi 的碰撞规则：项目级与用户级同名时取项目级，全局副本被跳过（会话启动会报 collision）——见 §2 pi 部署变体。

---

## 1. anysearch

**正确源**：`https://github.com/anysearch-ai/anysearch-skill`（GitHub 官方仓库）
**当前版本**：**v3.1.1**（2026-09-02 发布；2026-09-11 本机升级完成）
**运行时**：`.js` 用 `bun` 跑；`.py` 用 `uv run python`（`runtime.conf` 指定的是 `.py`）

### 两份部署位置（真目录，非 symlink，均受 INVEST git 跟踪）

- `~/Documents/github/INVEST/.pi/skills/anysearch`（pi 项目级）
- `~/Documents/github/INVEST/.omp/skills/anysearch`（omp 项目级）

### 本机补丁 3 处（换机恢复 / 升级时逐条重打）

| # | 文件 | 补丁内容 | 锚点（紧跟其后插入） | 规模 | 适用 |
|---|------|----------|---------------------|------|------|
| 1 | `scripts/anysearch_cli.js` | kdbx 三常量 + `loadKeyFromKdbx()` + 调用 | `loadEnv();` | +24 行 | 两份 |
| 2 | `scripts/anysearch_cli.py` | 同上 Python 版（`subprocess` + `timeout=15` 防 OneDrive 挂起） | `_load_env()` | +28 行 | 两份 |
| 3 | `SKILL.md` | frontmatter 加 `disable-model-invocation: true` | `    storage: ".env file, ..."` 行 | +1 行 | **仅 `.pi` 份** |

> ⚠️ **v3.1.1 新增 `# BEGIN/END GENERATED:CONSTANTS` 自动生成区块**（`CLIENT_HEADER` 版本号由 `generate.py` 自动同步）。
> 补丁锚点在区块**之前**，位置安全；但**切勿把补丁插进 GENERATED 区块内**（会被 `generate.py` 覆盖）。

### ⚠️ SHA256SUMS 校验的预期 FAILED（v3.1.1 新增）

v3.1.1 起附 `SHA256SUMS.txt`。本机改过脚本，所以校验会出现 **2 FAILED / 2 OK**，**这是预期而非故障**：

```bash
cd <skill_dir> && shasum -a 256 -c SHA256SUMS.txt
# scripts/anysearch_cli.py:  FAILED   ← 本机 kdbx 补丁所致，正常
# scripts/anysearch_cli.js:  FAILED   ← 本机 kdbx 补丁所致，正常
# scripts/anysearch_cli.ps1: OK       （未改）
# scripts/anysearch_cli.sh:  OK       （未改）
```

### 部署 / 升级步骤

1. 锁定 tag 拉源：`git clone --depth 1 --branch v3.1.1 https://github.com/anysearch-ai/anysearch-skill <tmp>`
2. 复制到两份目标目录，**重打上表 3 处补丁**（`.pi` 份记得补丁 3）
3. 写 `runtime.conf`（本机产物；`.pi` 份写 `.pi` 路径，`.omp` 份写 `.omp` 路径）
4. 新开 pi / omp 会话生效

### 升级方法：三方比对拆解法（**不要整目录覆盖**）

直接覆盖会丢掉本机 kdbx 补丁。正确做法：

```
官方旧版 → 官方新版  = 官方改动（直接取）
官方旧版 → 本机旧版  = 本机补丁（需重打）
```

1. 同时 clone 官方新旧两个 tag
2. 逐文件 sha 比对，把差异文件分成三类：**纯官方旧版**（直接覆盖）/ **含本机补丁**（重打）/ **官方新增**（采纳）
3. 在本机版上重打补丁，验证「与官方新版比对 = 纯新增零删除」

**关键命令**（项目级）：

```bash
# .js（justfile senti-search-cn 用的就是这个）
bun .pi/skills/anysearch/scripts/anysearch_cli.js search "hello world" --max_results 1
# .py（runtime.conf 指定的形态）
uv run python .pi/skills/anysearch/scripts/anysearch_cli.py get_sub_domains --domain finance
```

> v3.1.0 起改为 Direct HTTP CLI（直调 `/v1/search` 等 REST，移除 MCP/JSON-RPC wrapper）。
> v3.1.1（2026-09-02）：新增 SHA256SUMS.txt + 安全指引；`CLIENT_HEADER` 移入 GENERATED 区块自动同步版本号。

---

## 2. byted-web-search

**正确源**：`https://skills.volces.com/skills/bytedance/agentkit-samples`（火山官方 skill 市场）
**当前版本**：**v1.3.8**（2026-09-11 核验：市场最新 = 本机版本，**无需更新**）
**运行时**：Python 脚本，用 `uv run python`（非系统 `python`）

> ⚠️ **不要用 GitHub 当版本真源**：`github.com/bytedance/agentkit-samples` 的 `skills/byted-web-search/SKILL.md` 停在 **v1.3.4**（该路径最后提交 2026-05-11），
> 而市场版是 **v1.3.8**，两者文本有差异（GitHub 版无 `AGENT_PLAN_URL` bug，市场版有）。**版本的权威源是火山市场**。
> 查市场版本（不安装，零风险）：
> ```bash
> bunx skills add "https://skills.volces.com/skills/bytedance/agentkit-samples" -l
> ```
> ⚠️ **不要用 `skills add` 安装**——实测会向 **79 个 agent 目录**扩散（详见 §5 硬规则）。

### 两份部署位置

- `~/.pi/agent/skills/byted-web-search`（pi **用户级**；⚠️ **不在任何 git 仓库里**，含补丁，换机会丢）
- `~/Documents/github/INVEST/.omp/skills/byted-web-search`（omp 项目级，受 INVEST git 跟踪）

### 本机补丁 4 处（换机恢复 / 升级时逐条重打）

| # | 位置 | 补丁内容 | 规模 |
|---|------|----------|------|
| 1 | `scripts/web_search.py` 顶部 | `KEEPASSXC_CLI` / `KDBX_DB` / `KDBX_KEYFILE` 三常量（支持环境变量覆盖） | +4 行 |
| 2 | 同文件，常量区 | `AGENT_PLAN_URL = AGENT_PLAN_API_KEY_URL` — **修上游 NameError bug**（市场版 281/485 行引用但未定义，截至 2026-09-11 仍未修） | +3 行 |
| 3 | `scripts/web_search.py` `_get_api_key()` | kdbx fallback：`subprocess.run` 调 keepassxc-cli（`timeout=15` 防 OneDrive 挂起），失败打 stderr **不静默** | +13 行 |
| 4 | 同上，错误提示 | `pip install requests` → `uv add requests（或 uv run --with requests）` | 1 行 |
| 5 | `README.md` | `python3 scripts/...` → `uv run python scripts/...` | 1 行 |
| 6 | `SKILL.md` | frontmatter 加 `hide: true` + `disable-model-invocation: true`（**仅 `.pi` 份**）+ `python3` → `uv run` | 3 行 |
| — | 目录级 | **新增 `pyproject.toml`（依赖 `requests`）+ `uv.lock`** —— 官方源没有这两个，非项目目录内 `uv run` 必需 | 2 个文件 |

### 版本比对方法（验证是否需要升级）

```bash
# 1) 安全下载到临时项目（不碰主部署）
mkdir -p /tmp/dl && cd /tmp/dl && git init -q
bunx skills add "https://skills.volces.com/skills/bytedance/agentkit-samples" \
  -s byted-web-search --copy -y
# → 落在 /tmp/dl/.pi/skills/byted-web-search（及 .agents/ hub，全在临时目录内）
# 2) 比版本 + 比内容
```

> 2026-09-11 实测结论：市场最新版 **1.3.8 = 本机 1.3.8**（同版本），3 个文件有差异但
> **全部是本机补丁**（`README.md`/`SKILL.md`/`web_search.py`，共 22 行），无任何市场侧改动 → **无需升级**。

**关键命令**（项目级）：

```bash
# 运行/验证（用 uv run，不用 python）；pi 部署位：
uv run python ~/.pi/agent/skills/byted-web-search/scripts/web_search.py "搜索词" --count 5
```

> **注意**：`npx skills add ...` 会装到 `.agents/`、`.claude/` 等**非 omp 目录**，且不带本地的 kdbx 注入——本项目不用它，直接从源取 skill 目录后手工注入。

### pi 部署变体（2026-09-03，v1.3.4）

`npx skills add` 对 **pi 原生可用**（CLI 直接装到 `~/.pi/agent/skills/`）。两个已核实的坑：

- **`~/.agents/` 是 skills CLI 自己的 hub（账本 `.skill-lock.json`），不是 agy 的用户级 skill 目录**——agy（Antigravity CLI）亲口确认：它只自动发现 **workspace 级** `<项目>/.agents/skills/` 和全局 `~/.gemini/config/`，不扫用户级 `~/.agents/`。CLI 会按检测到的 agent 多份复制（本机连 `~/.kiro/` 历史残留也塞了一份）。
- **`skills remove <name> -g` 会从所有 agent 目录一并卸载**（包括 pi 主部署），不只是 hub——误伤后需从源重装重打补丁。

结论：**hub 与副本全部删掉，只保留 `~/.pi/agent/skills/` 主部署**；以后想让 agy 用，在项目里建 workspace 级 symlink 指向 pi 那份（并 gitignore，因含 kdbx 本机补丁）：

```bash
npx -y skills add https://skills.volces.com/skills/bytedance/agentkit-samples -s byted-web-search -g --copy -y   # 之后清 hub
rm -rf ~/.agents   # 或加 -a 圈定避免多余副本：npx skills add ... -a pi
```

装完需两处本地化（针对 `~/.pi/agent/skills/byted-web-search/`，omp 部署可参照）：

1. `scripts/web_search.py`：按 §4 注入 kdbx 取 key（`_get_api_key` 增加 `_load_api_key_from_kdbx()`，`subprocess.run` 带 `timeout=15`）。注：skills.volces.com well-known 版有 `AGENT_PLAN_URL` 未定义的 NameError bug，需补定义；GitHub agentkit-samples 源码版无此 bug（两者文本有差异，打补丁前先 grep 锚点）
2. skill 目录加 `pyproject.toml`（依赖 `requests`），SKILL.md 调用改为 uv 形式（GitHub 版：`uv run --project {baseDir} python {baseDir}/scripts/web_search.py ...`）

验证：`cd ~/.pi/agent/skills/byted-web-search && uv run python scripts/web_search.py "搜索词" --count 3`（首次 uv 自动建 .venv；kdbx 注入成功则直接出结果，无凭证报错）。pi 会话启动时扫描 skill 目录，装完需新开会话生效。

> **2026-09-04 迁移：pi 统一用用户级，不再放 INVEST 项目级**
> INVEST 项目级副本与全局主部署撞名（pi auto 取项目级、全局副本被跳过，会话启动每次报 collision），已 `git rm`（INVEST 提交 6744c16）。现状：
> - **pi 部署位 = `~/.pi/agent/skills/byted-web-search`（真目录，非 symlink）**，v1.3.8 补丁版（从 INVEST 项目副本同步，含 2026-08-14 NameError 修复、错误提示、quick-start/troubleshooting）+ `pyproject.toml`（依赖 requests，非项目目录内 uv run 必需）
> - **补丁版真源**：INVEST git 库（`.omp/skills/byted-web-search` 副本仍跟踪 v1.3.8，与 pi 版仅差 SKILL.md 的 `disable-model-invocation: true` 一行；`.pi/skills` 删除前内容在提交 6744c16 的父提交）。换机恢复：官方源拉取+§4 注入，或从 INVEST 库 `.omp` 副本拷贝后补 `pyproject.toml` 与 frontmatter
> - **INVEST 侧引用已改指全局路径**：`justfile` web-search recipe、`scripts/append_byted.py` sys.path（`Path.home() / ".pi/agent/skills/byted-web-search/scripts"`）
> - omp 项目副本（INVEST `.omp/skills/`）不动，供 omp 会话；pi 会话在 INVEST 内同样自动发现用户级 skill，功能无损失

---

## 3. twitter-cli / rdt-cli（舆情信源，uv tool 安装）

不是 skill，而是**舆情管道的两个一级信源 CLI**（之前遗漏登记，2026-09-11 补入）：

| 工具 | 管道用途 | 命令入口 | 层级 |
|------|----------|----------|------|
| **twitter** | 推文抓取（白名单 32 条 hand 中 16 个日更 hand ✓） | `just senti-tw-all` | A 级主证据 / B 级交叉验证 |
| **rdt** | Reddit 热帖（r/wallstreetbets） | `just senti-rd wallstreetbets` | C 级情绪参考 |

### 安装与位置

```bash
uv tool install twitter-cli
uv tool install rdt-cli
```

- 安装目录：`~/.local/share/uv/tools/{twitter-cli,rdt-cli}/`
- 命令 symlink：`~/.local/bin/{twitter,rdt}`（已在 PATH）
- **无本机补丁**（开箱即用）
- 认证：`twitter status` / `rdt status --json`（供 `just senti-check` 预检）

### 升级与版本核验

```bash
# 当前版本
uv tool list                              # 列出所有 uv tool 及版本
twitter --version                         # twitter, version 0.8.5
rdt --version                             # rdt, version 0.4.1

# 与 PyPI 最新版对比
for p in twitter-cli rdt-cli; do
  printf "%-12s 已装: " "$p"; uv tool list 2>/dev/null | grep -A1 "^$p" | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1
  printf "%-12s PyPI: " "$p"; curl -s "https://pypi.org/pypi/$p/json" | python3 -c "import sys,json;print(json.load(sys.stdin)['info']['version'])"
done

# 升级（若有新版本）
uv tool upgrade twitter-cli
uv tool upgrade rdt-cli
```

> **2026-09-11 核验结论**：两者均已是 PyPI 最新（twitter-cli **0.8.5** 发布于 2026-03-17；rdt-cli **0.4.1** 发布于 2026-03-15）→ **无需更新**。
> 两个包自 3 月中旬后未发新版，上游活跃度低；若将来管道报错，优先查 CLI 输出而非版本。

---

## 4. 用 keepassxc-cli 从 kdbx 取 key（核心方法）

两个 skill 的 key 统一存于 KeePassXC 数据库，**keyfile-only 解锁**（`--no-password --key-file`）。脚本运行时动态读取，**不落明文 `.env`**。

### 数据库与解锁

- 数据库：`/Users/panyu/Library/CloudStorage/OneDrive-个人/100Archive/100dataapp/pass/apienv/envapi.kdbx`
- keyfile：`/Users/panyu/Library/CloudStorage/OneDrive-个人/100Archive/100dataapp/pass/apienv/envapi.key`（同目录，64B 随机二进制）
- 条目：`anysearch`、`byted-web-search`（Password 即 API key）
- keepassxc-cli：`/Applications/KeePassXC.app/Contents/MacOS/keepassxc-cli`（本机唯一路径，非 PATH）

### 读取命令（关键）

```bash
# -a Password 直接输出该属性值（无 label 解析）；-s 确保 protected 属性显示明文
# keyfile-only：--no-password --key-file；KDBX 4 格式（keepassxc-cli 2.7.12 原生支持）
keepassxc-cli show --no-password --key-file <keyfile> -s -a Password <db> <entry>
```

### 脚本内注入方式

- **anysearch**（Node）：`loadEnv()` 后加 `loadKeyFromKdbx()`——`execFileSync` 调 keepassxc-cli，解析输出注入 `process.env.ANYSEARCH_API_KEY`
- **byted**（Python）：`_get_api_key()` 里 `subprocess.run` 调 keepassxc-cli（带 `timeout=15` 防 OneDrive 目录挂起），解析注入 `WEB_SEARCH_API_KEY`

**要点**：
- 路径收敛为模块级常量，支持环境变量覆盖（`KEEPASSXC_CLI` / `KDBX_DB` / `KDBX_KEYFILE`），默认值即本机 OneDrive 路径
- 失败不静默：向 stderr 打一行不含密钥的原因（`kdbx fallback failed: ...`），不阻断（可匿名访问或走 AK/SK）
- 密钥走 stdout 捕获，不进命令行参数/进程列表/日志

---

## 5. 硬规则

- 🔴 **密钥永不入库**：API key/token 一律占位或存 kdbx；提交前跑 `grep -rE 'as_sk_[a-z0-9]{20,}|sk-[a-z0-9]{20,}|WEB_SEARCH_API_KEY=.{8,}' .`（有输出则停下）
  > 注：该模式会命中官方文档里的**占位符**（`<your_api_key_here>`、`as_sk_xxxx...`），请人工判断而非机械报错。
- 🔴 **本机禁全局安装依赖**：不用 `npx`、系统 `python`/`node`、`brew install`——一律 `bun`/`bunx`/`uv run`（项目级，见 AGENTS.md）
- 🔴 **skill 一律复制安装**（2026-09-03 起）：从官方源取 skill 目录复制进目标 skill 目录，再做本机本地化；**不用 `skills add` 安装**
  （`npx` 或 `bunx` 均同）——**实测会向 79 个 agent 目录扩散**（2026-09-11 实测输出：`Installing to: Antigravity, Antigravity CLI, Gemini CLI, Kimi Code CLI, Pi +16 more`），
  不带本机补丁，且 `skills remove -g` 会误伤主部署（详见 §2 pi 部署变体）。
  > ✅ **安全用法**：`bunx skills add ... -l` 仅列清单不安装（**零风险**，可用于查市场版本）；
  > 需下载比对时，在 `/tmp` 建临时 git 项目再装，扩散产物全落在临时目录内，主部署不受影响。
- 🔴 `runtime.conf`、`.env` 属本机自维护产物（含本机路径/密钥），不入 git
  > 现状不一致：`.omp/skills/anysearch/runtime.conf` 受跟踪，`.pi/` 那份未跟踪（内容仅路径无密钥）——既有状态，不动。
- 🟡 换机时改两脚本内的 `KEEPASSXC_CLI`/`KDBX_DB`/`KDBX_KEYFILE` 常量（或设环境变量），key 仍由 kdbx 提供
- 🔴 **升级 = 重打补丁，禁止整目录覆盖**：anysearch/byted 都带本机补丁（共 10 处），直接覆盖会丢。
  用 §1 的**三方比对拆解法**：官方旧版↔官方新版=官方改动，官方旧版↔本机=本机补丁，在新版上重打。
- 🔴 **两份部署必须同升**：anysearch / byted 各有 `.pi` 与 `.omp` 两份，升级时两份都要处理（差异见顶部速查表）。
- 🔴 **升级后必跑功能实测**：不能只看文件到位——要实际调一次 CLI（`bun ... search "测试"` / `uv run python ... "测试"`），
  确认 kdbx 取 key 仍正常（补丁锚点漂移会导致静默失效）；anysearch 还需对 `SHA256SUMS.txt` 确认
  **仅 `.py`/`.js` 两个 FAILED**（本机补丁所致），`.ps1`/`.sh` 应为 OK。

### 密钥真源（KeePassXC）

| skill | 条目 | key 环境变量 | 来源 |
|---|---|---|---|
| anysearch | `anysearch` | `ANYSEARCH_API_KEY` | https://github.com/anysearch-ai/anysearch-skill |
| byted-web-search | `byted-web-search` | `WEB_SEARCH_API_KEY` | https://skills.volces.com/skills/bytedance/agentkit-samples |

> 换机恢复：clone dotfiles → 按 §1/§2 拉 skill（**两份都建**）→ 重打补丁（anysearch 3 处 / byted 4 处，见各自章节）
> → 注入 §4 的 kdbx 取 key → 改路径常量 → 装 §3 的两个 uv tool → 新开会话生效。key 从 kdbx 取，不依赖 git 存密钥。
>
> ⚠️ **最易漏的一步**：byted 的 pi 副本（`~/.pi/agent/skills/byted-web-search`，**含补丁**）**不在任何 git 仓库里**——
> 换机后必须从 INVEST 库的 `.omp` 副本拷回，或按 §2 从官方源重打补丁，否则该 skill 会丢。
