# agent 派发与状态轮询（本机实战，2026-09-23）

在 herdr 里**派子 agent 干活**这件事的本机口径与坑。命令语义真源仍是官方 `SKILL.md` 与 `herdr agent` / `herdr pane` 的输出；本文只记"怎么用不出错"。

## 派发节奏（4 步，别同步等）

```bash
# 1) 开 panel（--cwd 指目标项目；--no-focus 不抢用户焦点）
herdr pane split --current --direction down --cwd <目标目录> --no-focus
#    从返回 JSON 取 .result.pane.pane_id

# 2) 起 agent
herdr agent start <name> --kind pi --pane <pane_id>

# 3) 投任务书：**不加 --wait**（加了就把当前会话卡住等它干完）
herdr agent prompt <name> '<任务书全文>'

# 4) 回头收（先干别的/先回用户，稍后再轮询）
herdr agent list                                                  # 状态总览（最便宜的轮询）
herdr agent read <name> --source recent-unwrapped --lines 60      # 输出/汇报
herdr agent wait <name> --timeout 300000                          # 仅当必须等结果，且有界
```

**多任务就一次派 N 个**（各自 `agent prompt`，都不带 `--wait`），再一条 `agent list` 看全局。

## 状态语义与对应动作

| 状态 | 含义 | 动作 |
|---|---|---|
| `working` | 干活中 | 别打扰 |
| `done` | 干完，**但还没被看过** | 去 `agent read` |
| `blocked` | 等你回话（提问/审批） | `agent read` 看它问什么，回答 |
| `idle` | 已看过 / 空闲待命 | 可投新任务 |
| `unknown` | 认不出 agent 状态 | **不代表完成**，去看 read |

> `done` vs `idle` 由服务端的 seen 状态区分：显式 focus 才标记已看，**read 不会**。

## 坑单

1. **`agent prompt --wait --timeout N` —— ✅ 可用（2026-09-27 修正，推翻旧结论）**
   实测 3 次（同日，herdr 当前版）：任务 1「回个 OK」耗时 26.5s · 任务 3「跑 `just check --regress`」耗时 **15s**、返回时状态 `done` **且输出含检查结果** → **它等的是真 settled，不是「看到活动就返回」**。
   ⚠️ **两个边界**：① **必须带 `--timeout`**（无 timeout = 无限期，主会话 bash 同步 → 停摆）；② 它只保证「settled」，**不保证任务成功** → 仍要 `agent read` 核证据（任务 2 耗时 6s，看似提前返回，实为子会话没真跑那件事——`--wait` 不背这个锅）。
   📌 **历史修正**：2026-09-23 记的「派完 `agent wait --timeout 360000` 白等 6 分钟」疑为**误用**（官方语义 = 等**第一个 settled 状态**；若对象已 settled，就会白等或立即返回）。据那一次写成「不要用」**过宽**。
   ✅ **当前推荐（遵循官方）**：**就用 `agent prompt <target> "..." --wait --timeout N`** —— 官方示例即 `--wait --timeout 120000`；**短任务 2 分钟，长任务把 timeout 调大**（官方明说「Without a timeout, the settled-state wait is indefinite」→ 带 timeout 就受它约束，**不是「长任务不能用」**）。
   ⚠️ **唯一属于本机的策略（非官方限制）**：若我需要在等待期间**同时干别的活** → 改用 `sleep N && agent list` 轮询（因为主会话 bash 是同步的，「等」= 我在那儿干等着）。
   📖 **官方三条易漏语义**（`herdr --skill` 原文）：① “**This wait tracks lifecycle state, not an individual turn**; if the agent is already working, **completion of the active turn may satisfy it**” → **别在 agent 正在 working 时投新任务**（会被上一轮完成提前满足）；② “**Without a timeout, the settled-state wait is indefinite**” → 必须带 timeout；③ “The caller timeout **includes submission time**”。
   📖 官方补充（`herdr --skill`，214 行，2026-09-27 核对仍是 09-22 版）：`--wait` 会有 **5 秒 activity gate** —— 从非 working 状态发 prompt 必须观察到 `working`/`blocked` 活动，否则返回 `agent_prompt_stalled`。
2. `--until` 与 `--wait` 连用属反模式（官方明说不必重复默认值）；`--until` 只用于"等某特定状态"的流程（如 `agent wait X --until blocked`）。
3. `agent prompt` 返回 `agent_prompted` **只代表已送达**，不代表已开工；要确认开工看 `agent list` 是否 `working`。
4. **超时/中断 ≠ 未送达**（官方原话：a timeout or stalled response does not prove the prompt was never delivered; do not blindly submit it again）→ 先 `agent read` 看它干到哪了，别重复投递整份任务书。
5. 读输出优先 `agent read <name> --source recent-unwrapped`（按 agent 名，语义比 `pane read <pane-id>` 贴切）。
6. `pane split` 记得 `--cwd <目标> --no-focus`：漏加会落在当前目录、并抢走用户焦点。
7. `herdr notification` 命令组**只能发**桌面通知（`notification show`），**不能读完成事件** → 没有推送可依赖，回头 `agent list` 就是最便宜的轮询。
8. 关 pane 用 `herdr pane close <id>`；**任务完成后再关**（子会话可能追问，如"要人工点验证码"）。
9. 子会话说"做完了"要**用证据核**（落盘文件、截图路径、状态原文），不要只看结论。
10. 子会话若 `blocked`（在等确认/提问），先 `agent read` 看它在问什么，别盲目再投任务。

## 官方正文的更新方法

```bash
herdr --skill > /tmp/new.md
# 与部署版正文比对（部署版 = 本机 header + 官方正文）
diff <(sed -n '/^# Herdr$/,$p' /tmp/new.md) <(sed -n '/^# Herdr$/,$p' ~/.pi/agent/skills/herdr/SKILL.md)
# 一致 → 无需动；不一致 → 用官方正文替换部署版正文段，保留本机 header
```

2026-09-23 核对：部署版正文与官方输出**逐行一致**（209 行）。

## 已派发记录（留档）

| 日期 | 任务 | 子会话 | cwd | 工具/结果 |
|---|---|---|---|---|
| 2026-09-23 | Semantic Scholar API key 申请 | `s2key` | comtools | bsk（人工点验证码）✅ |
| 2026-09-23 | 科研通发布 2 条求助 | `ablesci` | comtools | agent-browser ✅ |
| 2026-09-23 | 科研通收件（下载 + 采纳） | `harvest` | comtools | agent-browser ✅ |

> 业务侧口径（任务书 8 要素、浏览器工具选择、两个项目的交接边界）记在 writing 项目：`docs/技术手册/浏览器任务.md`。
