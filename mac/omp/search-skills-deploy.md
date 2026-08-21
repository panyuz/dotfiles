# 联网搜索 Skill 部署参考

> 真源仓库：`~/Documents/github/dotfiles`。本文档讲**两个联网搜索 skill 的部署方法与思路**，供换机/重装/迁移时按此重建。不逐条复刻 skill 内部文件，重思路、轻细节。
> **密钥永不入库**：真实 key 一律存 KeePassXC（见 §4），本文件只用 `<YOUR_KEY>` 占位。

## 部署思路总览

两个 skill 都是"**从官方源拉取 → 放入 omp skill 目录 → 脚本内嵌 keepassxc-cli 从 kdbx 取 key → 用项目级运行时调用**"。核心三件事：

1. **正确源**：各 skill 从官方仓库/市场拉取（见 §1/§2），不用来历不明的副本
2. **密钥**：不落明文 `.env`，脚本运行时用 `keepassxc-cli` 从 KeePassXC kdbx 动态取（见 §3）
3. **运行时**：一律用项目级命令（`bun`/`bunx`/`uv`），**不用 `npx`、系统 `python`/`node`**（本机禁全局安装依赖，见 §4）

### omp skill 目录（放对即自动注册）

- **项目级**：`<项目>/.omp/skills/<name>`（本项目用这个）
- **用户级**：`~/.omp/agent/skills/<name>`（跨项目共享）
- omp 启动时自动扫描目录，放对即注册，无需改 config.yml；改 skill 后需重启 omp 会话生效

---

## 1. anysearch

**正确源**：`https://github.com/anysearch-ai/anysearch-skill`（GitHub 官方仓库）
**当前版本**：v3.1.0
**运行时**：Node 脚本，用项目内 `bun` 运行（非系统 `node`）

**部署思路**：
1. 从官方仓库下载锁定 tag（`v3.1.0`）zip，解压重命名为 `anysearch`，放入 `.omp/skills/anysearch`
2. 在 `scripts/anysearch_cli.js` 的 `loadEnv()` 后注入 `loadKeyFromKdbx()`（见 §3）
3. 写 `runtime.conf`，Command 用 `bun` 调用脚本
4. 重启 omp 会话，`skill://anysearch` 可解析

**关键命令**（项目级）：
```bash
# 运行/验证（用 bun，不用 node）
bun .omp/skills/anysearch/scripts/anysearch_cli.js get_sub_domains --domain finance
bun .omp/skills/anysearch/scripts/anysearch_cli.js search "hello world" --max_results 1
```

> v3.1.0 起改为 Direct HTTP CLI（直调 `/v1/search` 等 REST，移除 MCP/JSON-RPC wrapper）。

---

## 2. byted-web-search

**正确源**：`https://skills.volces.com/skills/bytedance/agentkit-samples`（火山官方 skill 市场；对应 GitHub `bytedance/agentkit-samples`）
**当前版本**：v1.3.8
**运行时**：Python 脚本，用项目内 `uv run` 运行（非系统 `python`）

**部署思路**：
1. 从火山官方源获取 skill（或从 GitHub `bytedance/agentkit-samples/skills/byted-web-search`），放入 `.omp/skills/byted-web-search`
2. 在 `scripts/web_search.py` 的 `_get_api_key()` 里注入 kdbx 取 key（见 §3），并补 `AGENT_PLAN_URL` 定义（上游有 NameError bug）
3. 重启 omp 会话，`skill://byted-web-search` 可解析

**关键命令**（项目级）：
```bash
# 运行/验证（用 uv run，不用 python）
uv run python .omp/skills/byted-web-search/scripts/web_search.py "搜索词" --count 5
```

> **注意**：`npx skills add ...` 会装到 `.agents/`、`.claude/` 等**非 omp 目录**，且不带本地的 kdbx 注入——本项目不用它，直接从源取 skill 目录后手工注入。

---

## 3. 用 keepassxc-cli 从 kdbx 取 key（核心方法）

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

## 4. 硬规则

- 🔴 **密钥永不入库**：API key/token 一律占位或存 kdbx；提交前跑 `grep -rE 'as_sk_[a-z0-9]{20,}|sk-[a-z0-9]{20,}|WEB_SEARCH_API_KEY=.{8,}' .`（有输出则停下）
- 🔴 **本机禁全局安装依赖**：不用 `npx`、系统 `python`/`node`、`brew install`——一律 `bun`/`bunx`/`uv run`（项目级，见 AGENTS.md）
- 🔴 `runtime.conf`、`.env` 属本机自维护产物（含本机路径/密钥），不入 git
- 🟡 换机时改两脚本内的 `KEEPASSXC_CLI`/`KDBX_DB`/`KDBX_KEYFILE` 常量（或设环境变量），key 仍由 kdbx 提供

### 密钥真源（KeePassXC）

| skill | 条目 | key 环境变量 | 来源 |
|---|---|---|---|
| anysearch | `anysearch` | `ANYSEARCH_API_KEY` | https://github.com/anysearch-ai/anysearch-skill |
| byted-web-search | `byted-web-search` | `WEB_SEARCH_API_KEY` | https://skills.volces.com/skills/bytedance/agentkit-samples |

> 换机恢复：clone dotfiles → 按 §1/§2 拉 skill → 注入 §3 的 kdbx 取 key → 改路径常量 → 重启 omp 会话。key 从 kdbx 取，不依赖 git 存密钥。
