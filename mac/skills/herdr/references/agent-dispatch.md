# agent 派发与状态轮询（本机实战）

本文记 herdr 里派子 agent 的口径与坑。命令语义的真源是官方 `SKILL.md`，以及 `herdr agent` 与 `herdr pane` 的输出。本文只回答一件事：怎么用不出错。

> **分工（2026-10-12 起）**：派发/回收 worker（assign · handoff · watch · collect · send · 模型列举）**优先用 `herdr-dispatch` skill**（已装全局：job store + generation 对账 + 交付物文件 + 有界 watch ≤60s；它明文禁止手写原始 `herdr agent` 序列）。本文件只留：① 控制面语法 ② herdr 生命期语义 ③ 本机踩过的坑（含 2026-10-12 五条）。

## 派发（4 步，不要同步等）

```bash
# 1) 开 panel。--cwd 指目标项目，--no-focus 不抢用户焦点
herdr pane split --current --direction down --cwd <目标目录> --no-focus
#    从返回的 JSON 取 .result.pane.pane_id

# 2) 起 agent
herdr agent start <name> --kind pi --pane <pane_id>

# 3) 投任务书。默认不加 --wait
herdr agent prompt <name> '<任务书全文>'

# 4) 回头收。先干别的，稍后再轮询
herdr agent list
herdr agent read <name> --source recent-unwrapped --lines 60
```

多任务就一次派 N 个。每个都发一次 `agent prompt`，都不带 `--wait`，再用一条 `agent list` 看全局。

`pane split` 必须带 `--cwd <目标> --no-focus`。漏加会落在当前目录，并抢走用户焦点。

## 状态语义与动作

| 状态 | 含义 | 动作 |
|---|---|---|
| `working` | 干活中 | 不打扰 |
| `done` | 干完，但还没被看过 | `agent read` |
| `blocked` | 等你回话（提问或审批） | `agent read`，看它问什么 |
| `idle` | 已看过，或空闲待命 | 可投新任务 |
| `unknown` | 认不出状态 | 不代表完成。去 `agent read` |

`done` 与 `idle` 靠服务端的 seen 状态区分。只有显式 focus 才标记已看。`agent read` **不会**标记已看。

## `--wait` 的三种用法

- **短任务**：`herdr agent prompt <name> "..." --wait --timeout 120000`。官方示例就是这个形状。
- **长任务**：把 timeout 调大。它等的是真 settled，不是「看到活动就返回」。
- **要同时干别的活**：不要用 `--wait`。主会话的 bash 是同步的，「等」就是你干等着。改用 `sleep N && herdr agent list` 轮询。

实测三次（2026-09-27 同一天，当前版）：回「OK」耗时 26.5 秒；跑 `just check --regress` 耗时 15 秒，返回时状态 `done` 且输出含检查结果。

WARNING：`--wait` 必须带 `--timeout`。无 timeout 时 settled 等待是无限期的，主会话会停摆。

WARNING：`--wait` 只保证 settled，不保证任务成功。仍要 `agent read` 核证据。一次实测 6 秒返回，但子会话没真跑那件事。

WARNING：不要在 agent 正在 `working` 时投新任务。官方语义是本轮完成即可满足等待，所以会被上一轮提前满足。

`--until` 与 `--wait` 连用属反模式，除非你要等某个特定状态，例如 `agent wait X --until blocked`。

官方三条易漏语义（`herdr --skill` 原文）：

1. "This wait tracks lifecycle state, not an individual turn; if the agent is already working, completion of the active turn may satisfy it".
2. "Without a timeout, the settled-state wait is indefinite".
3. "The caller timeout includes submission time".

官方另有一条：`--wait` 有 5 秒 activity gate。从非 working 状态发 prompt 时，必须观察到 `working` 或 `blocked` 活动，否则返回 `agent_prompt_stalled`。

## 轮询间隔：15 到 20 秒

推荐 `sleep 15 && herdr agent list`，或 20 秒。

- 小于 10 秒：子会话常还在启动或读上下文。`agent list` 只见 `working`，空轮询白费。
- 15 到 20 秒：与子会话的典型动作粒度匹配，即读一群文件或跑一条命令。
- 大于 30 秒：可能错过 `blocked`。`blocked` 是唯一需要立刻响应的状态，错过就白等。

按任务长短调。长任务（评审、审计，5 到 20 分钟）用 20 秒。短任务（小于 1 分钟）用 10 到 15 秒。首次轮询前多等一拍，子会话冷启动要 10 到 20 秒才切 `working`。

## 其余常踩的坑

- `agent prompt` 返回 `agent_prompted` 只代表已送达，不代表已开工。确认开工看 `agent list` 是否是 `working`。
- 超时或中断不等于未送达。官方原话是 "a timeout or stalled response does not prove the prompt was never delivered; do not blindly submit it again"。先 `agent read` 看它干到哪了，不要重复投整份任务书。
- 读输出优先用 `agent read <name> --source recent-unwrapped`。按 agent 名读比 `pane read <pane-id>` 贴切。
- 子会话说「做完了」要用证据核：落盘文件、截图路径、状态原文。
- 子会话 `blocked` 时，先 `agent read` 看它问什么，不要盲目再投任务。
- `herdr notification` 只能发桌面通知，不能读完成事件。没有推送可依赖。`agent list` 就是最便宜的轮询。
- 关 pane 用 `herdr pane close <id>`。等任务完成后再关，子会话可能追问，例如要人工点验证码。

## 官方正文的更新方法

```bash
herdr --skill > /tmp/new.md
diff <(sed -n '/^# Herdr$/,$p' /tmp/new.md) <(sed -n '/^# Herdr$/,$p' ~/.pi/agent/skills/herdr/SKILL.md)
```

一致就不用动。不一致时，用官方正文替换部署版的正文段，保留本机 header。

## 2026-10-12 实测五条（服务端事件等待 · 回注时序）

1. **`agent wait` 的 `--until` 一旦显式写出就只认那一态**：`--until done` 在 agent 以 `idle` 结束时**不返回**（挂到超时）；写全 `--until idle --until done --until blocked`，或省略 `--until`（默认三态）。已达成状态**立即返回**（实测 0.006 s）。
2. **后台等待的正确形状**：`nohup herdr agent wait <target> --until idle --until done --timeout 600000 > /tmp/wait.json 2>&1 &` —— 退出即唤醒（调研文档 §方案 2 要点 1）；一次性，返回后要重启；收尾记得 kill。
3. **herdr-watch 看不到 TUI 命令**：`/reload`、`/db-update` 这类不产生 agent turn → `agent_status` 不变 → 无推送。这类操作只能 pane 轮询或 `agent read` 盯。
4. **注入结果会滞后于 turn**：子会话在同一 turn 里 `sleep 30` 轮询会占住 turn → 结果注入等它结束（实测滞后 2.3–2.8 min）。派发后**结束回合**等回注；进度用交付物文件 mtime / `ps` 判。
5. **`agent_pane_busy` / `agent_not_ready` 是瞬态**：面板还不是空 shell 时 `agent start` 报 busy；稍等重试或等 `idle` 即好 —— **不是失败**，别重投任务书。

## 相关

- 跑 pi 的细节：`pi-interaction.md`。跑 agy 的细节：`agy-interaction.md`。
- 业务侧口径（任务书 8 要素、浏览器工具选择、两个项目的交接边界）记在 writing 项目：`docs/技术手册/浏览器任务.md`。
