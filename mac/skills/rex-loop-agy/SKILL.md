---
name: rex-loop-agy
description: 在 Rex 环境中手动运行 Antigravity (AGY) 长期任务与多代理循环。支持 AGY 原生后台子代理与通过 Rex 调动 Pi 或 AGY 同屏及新 tab 代理。仅在用户显式要求使用 Rex 运行长期任务或大任务循环时触发。严禁自发自动调用。
---

# Rex 长期任务（Antigravity / AGY）

仅在用户显式调用时使用。用户可提供任务书或已有任务目录。只要求状态或暂停时，只执行对应动作。

先读 [Rex 主循环（AGY）](rex-main-loop.md)。它负责环境与计划确认、派发边界、分级验收、恢复与安全边界。本文规定 AGY 在 Rex 环境中的后端路由、调动 Pi 规范与操作命令。需要字段示例时读 [任务记录示例](references/task-state.md)。需要回执细节时读 [Rex 文件回执](references/rex-reports.md)。`references` 是指向共享目录的软链，默认不改；用户明确要求时才改。

## 1. 环境核实与启动前确认（必做前置环节）

1. **先确认 Rex 环境**。检查环境变量 `$REX_SESSION` 与 `$REX_BLOCK`。读取 `rex` skill（或执行 `rex __internal skill`）获取当前 CLI 官方指南。运行 `rex whoami --json`、`rex block ls -s "$REX_SESSION" --json`、`rex session inspect "$REX_SESSION" --json`，核对主代理所在 `session_id`、`window_id`（tab）和 `block_id`（pane）的完整 ID。若当前不在 Rex 环境或 Rex 服务不可达，立即停止并报告用户，不得继续启动 loop。
2. **启动前计划与环节确认**。只加载技能而未给目标时，先整理任务，不启动代理。正式派发前，主代理必须明确任务目标、cwd、写入边界、拟选用的派发后端（哪些走 AGY 原生后台、哪些走 Rex 调动 Pi 或 AGY）、并发上限、阶段时限与验证等级。若目标、写入范围或后端选择存在未决项，先向用户确认，获批后再进入派发环节。
3. **会话与 Tab 命名**。确定“emoji + 任务概要”。把主代理专属 tab 改名为 `<emoji> <任务概要>`（`rex window rename -s "$REX_SESSION" <主代理window_id> "<emoji> <任务概要>"`）；共享 tab 保留整体任务名。请用户或当前环境执行 `/rename <中文名>` 命名当前 AGY 会话。Rex session 名称保持不变，除非用户要求。
4. **建立 `TODO.md`**。由 AGY 主代理按 [Rex 主循环（AGY）](rex-main-loop.md) 第 1 节在项目任务目录直接创建并维护 `TODO.md`（不另派状态记录员子代理）。记下主代理完整 `block_id` 作为 Rex 子代理回报地址。

## 2. 选择派发后端（AGY 原生后台 + Rex 调动 Pi/AGY）

先判断工作是否需要人实时看见，以及是否需要调用 Pi 的快速模型。再按本节选择后端。用户指定后端时优先。

| 条件 | 后端 | 要点 |
|---|---|---|
| 可明确派发，无需人实时观看（单任务） | **AGY 原生 `invoke_subagent`**（默认） | 后台运行，支持 `workspace: "share"\|"branch"` 隔离。完成时原生唤醒主代理 |
| 可明确派发，无需人实时观看（多目标并发/流水线） | **AGY 原生 `run_workflow`** | Python 脚本编排 `parallel` / `pipeline` 与 JSON `schema` 校验 |
| 需要可见或需跑 Pi 快速模型，且接受新 tab | **Rex 新 tab 调动 Pi/AGY** | 用 `rex window new` 在后台开新 tab，不占主分屏 |
| 必须当前 tab 同屏核对、人工插话，或同屏跑 Pi 快速模型 | **Rex 同屏 peer（`rex split`）** | 主代理留左半屏，子代理放右半区。人可直接看和插话 |
| 现有例外 | 主代理直接执行 | 只限 [Rex 主循环（AGY）](rex-main-loop.md) 第 2 节的三条例外 |

派发前主代理在 `TODO.md` 记下计划后端与选择原因。启动成功后记下 `conversationId` 或 Rex 完整坐标（`session_id`、`window_id`、`block_id`）。启动失败时记失败与原因，不留占位 ID。

### 2.1 AGY 原生后台（默认）

- 单一独立子任务调用 `invoke_subagent`：只读调研用 `research`，需要编辑或执行命令用 `self`；并行修改设 `workspace: "share"` 或 `"branch"`，模型按需选 `inherit` 或 `flash`。
- 多文件或分阶段批量任务调用 `run_workflow`：用 `parallel` 或 `pipeline` 编排并指定输出 `schema`。
- 派发后不建 Rex pane，不写 `rex send`。完成时由 AGY Reactive Wakeup 自动唤醒主代理。

### 2.2 Rex 新 tab 调动 Pi 或 AGY

```sh
rex window new -s "$REX_SESSION" "🐙sub｜<职责>" --focus=false --json -c <任务目录> \
  -- pi --name "🐙sub｜<职责>" --model magpie/auto/deepseek-flash --thinking high "<首任务>"
```

- 新 tab 在后台打开，不抢焦点。命令返回 `.window_id` 与 `.block_ids[0]`。
- 需要新 tab 跑 AGY worker 时，将 `--` 后替换为 `agy --dangerously-skip-permissions -i "<首任务>"`。

### 2.3 Rex 同屏 peer（当前 tab 分屏调动 Pi 或 AGY）

用于必须同屏核对、人工随时插话，或同屏调用交互式 Pi。主代理保留左半屏。子代理占用右半区。数量不含主代理。用户指定布局优先。

- 1–2 个代理：右侧上下排列。
- 3–4 个代理：右侧最多两列两行（2×2），保持 pane 可读。按当前布局选 anchor，用 `rex split`、`rex move` 或 `rex swap` 调整；调整前后核对完整 `block_id` 和布局。
- 超过 4 个代理：先把无需持续观察的工作改派 AGY 原生 `invoke_subagent` 后台。仍需同屏时新建代理工作 tab，名称以 `🐙sub` 开头并带主任务名，代理仍向原主代理 block 回报。

第一个子代理以主代理 block 为 anchor，向右分割，`--ratio 50`：

```sh
rex split -s "$REX_SESSION" -b <主代理block> --split=right --ratio 50 \
  --focus=false --label "🐙sub｜<职责>" --json -c <任务目录> \
  -- pi --name "🐙sub｜<职责>" --model magpie/auto/deepseek-flash --thinking high "<首任务>"
```

后续分屏以右侧已有子 pane 为 anchor（如 `--split=below`）。记录 anchor block、`window_id`、新 `block_ids[0]` 和 session，并用 `rex block inspect <block> --json` 复核 `window_id`。

需要同屏运行 AGY worker 时，将 `--` 后的启动命令替换为：

```sh
agy --dangerously-skip-permissions -i "<首任务>"
```

按需附加 `--model` 与 `--effort`（`low|medium|high|xhigh|max`）。

同一 tab 内多个 pane 只是并排终端，不是进程树。报告和回复按 pane、tab 描述，不写成父子进程结构。

#### 布局调整阈值

同屏子代理超过 4 个（不含主代理）时才调整布局。4 个及以下不做例行调整。

- 检查时机：只在派发或回收的工作轮次检查一次。不自动监听 pane 变化，不每次对话调整。
- 主代理：保留全高，单块面积最大。
- 子代理：活跃与受阻的优先可见；空闲的可以网格排列。
- 用户自定义布局优先。用户指定过布局时按用户要求，不覆盖。
- 调整只移动或缩放 pane。不重启进程，不改终端 ID 和 Pi 会话 ID。
- 超过 4 个时先复用空闲 pane，再考虑新增。

### 2.4 后端失败

子代理启动失败或权限受阻时，停止受影响分支并报告。不静默更换后端或模型，不用主代理直接执行绕过阻塞。更换后端需要用户同意，并记录原因。

## 3. AGY 调动与复用 Pi 子代理规范

- **模型与思考强度**：通过 Rex 调动 Pi 时，默认使用 `--model magpie/auto/deepseek-flash`。思考强度按难度取 `--thinking high` 至 `max`。
- **首任务直传与启动核对**：首任务随启动参数直接提交，不启动空会话再补发。启动后用 `rex capture -s "$REX_SESSION" -b <子代理block> --trim` 核对：会话名称、实际 provider、model、思考强度、cwd 及首任务已送达。模型或强度不可用时报告用户，不静默更换。创建超时后先查 `rex block ls`，避免重复派发。
- **复用空闲 Pi 终端与追问**：
  1. 先查本任务 `TODO.md` 中已登记的空闲 Pi pane。
  2. 运行 `rex capture -s "$REX_SESSION" -b <pi_block> --trim`，确认目标仍是该 Pi 会话、处于空闲等待输入状态、输入框无残留文字且无权限提示。
  3. 职责改变时先更新会话名：发送 `rex send -s "$REX_SESSION" -b <pi_block> '/name 🐙sub｜<新职责>'` 与 `rex send-key -s "$REX_SESSION" -b <pi_block> enter`。
  4. 发送新任务指令：`rex send -s "$REX_SESSION" -b <pi_block> "<任务指令>"` 与 `rex send-key -s "$REX_SESSION" -b <pi_block> enter`。
  5. 一个 pane 同一时间只跑一个任务。主任务共享 tab 保留整体任务名，代理工作 tab、pane 标签和 Pi 会话名统一以 `🐙sub` 开头。

## 4. 回报与等待

子代理完成、受阻或失败时：写报告 → 原子写回执 → 通知 → 结束本轮。

派发任务时要求子代理把完整结果写入 Markdown 报告文件，按摘要、证据和待核对事项分节，保留验收所需细节。

通知通道按后端区分：

- **AGY 原生 `invoke_subagent` / `run_workflow`**：完成时由系统原生通知唤醒主代理，不写 `rex send`。
- **Rex 同屏或新 tab 子代理（Pi 或 AGY）**：独立终端进程，没有原生通知。完成报告与原子 JSON 回执后，必须主动执行 `rex send` 加 `rex send-key enter` 通知 AGY 主代理 block。

Rex 子代理主动通知（只写四项：任务编号、完成/受阻/失败状态、一句摘要、报告绝对路径）：

```sh
rex send -s "$REX_SESSION" -b <主代理block> '子代理回报｜<任务编号>｜完成/受阻/失败｜<一句摘要>｜<报告绝对路径>'
rex send-key -s "$REX_SESSION" -b <主代理block> enter
```

发送前核对三项：目标仍是该 AGY 主代理交互会话；输入框没有用户文字；没有权限或问题确认提示。任一项无法确认时不发送，保留回执并记录原因。发送成功只证明终端收到输入，不证明主代理已处理。

主代理 blocked（权限提示、问题对话框、输入框有用户文字）时，Rex 子代理按 [Rex 主循环（AGY）](rex-main-loop.md) 第 4.1 节安全等待，不因暂时不能通知就结束。

主代理侧：正常派发后更新 `TODO.md` 并结束当前轮次，等待原生通知或终端回报输入唤醒。不轮询，不运行 `sleep` 循环，不高频抓屏，不常态使用 `wait-report.mjs`。只有异常补收或恢复时，才通过 `run_command` 运行等待器（单次不超过 60 秒）：

```sh
bun <本技能目录>/scripts/wait-report.mjs --timeout-ms 30000 <回执绝对路径> [<其他回执绝对路径> ...]
```

## 5. 长期任务完成判定、验收与收尾

完成判定（四条同时成立）：

1. 实际任务工作完成，产物路径可读。
2. 按 [Rex 主循环（AGY）](rex-main-loop.md) 第 5 节完成适用等级的验证。
3. 主代理验收最终报告。
4. 主代理在 `TODO.md` 写明完成和证据；有独立验收时记录验收代理身份与报告路径。

以下都不算完成：结束当前回复；派发成功；子代理自报完成；wait 超时；时间耗尽；上下文压缩。

验收、暂停与收尾按 [Rex 主循环（AGY）](rex-main-loop.md) 第 5 至 7 节执行。Rex 补充：只清理本次创建且已验收的 pane（`rex block close`）或新 tab（`rex window close`）；保留主代理终端和用户正在使用的资源；不向主代理自己的 block 发送输入。
