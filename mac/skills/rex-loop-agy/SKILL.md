---
name: rex-loop-agy
description: 手动运行 Rex 长期任务与大任务多代理循环。Gemini（Antigravity）作为主代理负责规划、拆分子任务与独立验收，默认在主 tab 同屏分屏派发子代理，主代理保留半屏。仅在用户显式要求使用 Rex 运行长期任务或大任务循环时触发。严禁自发自动调用。
---

# Rex 长期任务（Gemini / Antigravity）

仅在用户显式调用时使用。用户可提供任务书或已有任务目录。只要求状态或暂停时，只执行对应动作。

先读 [Rex 主循环](rex-main-loop.md)。它负责计划、派发边界、验收、恢复与安全边界。本文只写 Rex 操作。需要字段示例时读 [任务记录示例](references/task-state.md)。需要回执细节时读 [Rex 文件回执](references/rex-reports.md)。`references` 是指向共享目录的软链，默认不改；用户明确要求时才改。

## 1. 准备

1. 确定“emoji + 任务概要”。读当前 `rex` skill 及其官方正文。用 `rex whoami --json`、`rex block ls`、`rex session inspect` 核对主代理所在 session、window、block 的完整 ID。
2. 把主代理专属 tab 改名为 `<emoji> <任务概要>`（`rex window rename -s "$REX_SESSION" <主代理window_id> "<emoji> <任务概要>"`）；共享 tab 保留整体任务名。显式命名当前 Gemini 会话：请用户执行 `/rename <中文名>`。Rex session 名称保持不变，除非用户要求。
3. 按 [Rex 主循环](rex-main-loop.md) 第 1 节建立 `TODO.md`，记下 Rex 字段。
4. 记下主代理 block ID 作为回报地址。主动通知是首选通道，文件回执是备用。远程任务先验证远程通道。

## 2. 同屏分屏派发（默认）

默认在主代理所在 tab 内分屏。主代理保留半屏。子代理占用右半区。

1. 第一个子代理：以主代理 block 为 anchor，向右分割，`--ratio 50`。

   ```sh
   rex split -s "$REX_SESSION" -b <主代理block> --split=right --ratio 50 \
     --focus=false --label "<emoji 任务名>" --json -c <任务目录> \
     -- <启动命令>
   ```

2. 后续子代理：以右半区已有子 pane 为 anchor，向下分割。主代理比例不变。

   ```sh
   rex split -s "$REX_SESSION" -b <右侧子pane block> --split=below \
     --focus=false --label "<emoji 任务名>" --json -c <任务目录> \
     -- <启动命令>
   ```

3. 记录 anchor block、`window_id`、新 `block_ids[0]`、session。用 `rex block inspect <block> --json` 复核 `window_id`。
4. 用户指定其他布局时优先：新 tab（`rex window new -s "$REX_SESSION" "<名称>" --focus=false -c <任务目录> -- <启动命令>`）、其他 session、左右方向、其他比例都按用户要求。用户未指定时用第 1、2 步。

同一 tab 内多个 pane 只是并排终端，不是进程树。报告和回复按 pane、tab 描述，不写成父子进程结构。

## 3. 启动与模型

- **快速模型（推荐）**：
  ```sh
  pi --name "<emoji 任务名>" --model magpie/auto/deepseek-flash --thinking high "<首任务>"
  ```
  思考强度按难度取 `high` 至 `max`。
- **Antigravity 后台 Worker**：
  ```sh
  agy --dangerously-skip-permissions -i "<首任务提示词>"
  ```
  按需可附加 `--model` 与 `--effort`（`low|medium|high|xhigh|max`）。
- 首任务随启动作为参数提交，不启动空会话再补发。
- 启动后核对：名称、实际 provider、model、思考强度、cwd、首任务已送达。
- 模型或强度不可用时报告用户并等待选择，不静默更换。
- 创建超时后先查已有资源，避免重复派发。

## 4. 复用与命名

先查本任务有无空闲代理。复用时按顺序：核对目标 block 和输入框 → 更名 → 发任务。

- 共享 tab 保留整体任务名，pane 用 `--label`（或 Pi 会话 `/name`）区分具体子任务。
- 一个 pane 只跑一个任务。任务改变时更新名称。
- Pi 空闲且输入框可用时，才发送 `/name <名称>`。

## 5. 回报

子代理完成、受阻或失败时：写报告 → 原子写回执 → 主动通知 → 结束本轮等待。

派发任务时要求子代理把完整结果写入报告文件。报告优先用 Markdown，按摘要、证据和待核对事项分节；按任务调整，保留验收所需细节。子代理终端的最终回复只写任务 ID、状态和报告绝对路径，不复述报告正文或表格。必要的进度、错误和权限提示仍可显示。

主代理先读报告摘要，再按验收需要读取证据和实际产物。向用户交付时由主代理整理结果。不得以简短回执代替验收。

主动通知：

```sh
rex send -s "$REX_SESSION" -b <主代理block> '子代理回报｜T06-A1｜完成｜<报告绝对路径>'
rex send-key -s "$REX_SESSION" -b <主代理block> enter
```

发送前核对三项：目标仍是该主代理交互会话；输入框没有用户文字；没有权限或密码提示。任一项无法确认时不发送，保留回执并记录原因。发送成功只证明终端收到输入，不证明主代理已处理。

主代理侧：主动通知优先。文件回执和等待脚本只用于补收与恢复，不常态依赖。等待脚本不唤醒已退出的主代理。单次阻塞等待不超过 60 秒。普通等待超时不代表失败。需要补收或阻塞等待回执时，通过 `run_command` 运行等待器并设置合适的 `WaitMsBeforeAsync`：

```sh
bun <本技能目录>/scripts/wait-report.mjs --timeout-ms 30000 <回执绝对路径> [<其他回执绝对路径> ...]
```

**严禁使用 sleep 循环或高频轮询截图。**

## 6. 验收、暂停与收尾

按 [Rex 主循环](rex-main-loop.md) 第 5 至 7 节执行。Rex 补充：只清理本次创建且已验收的 pane（如 `rex block close`）或新 tab（`rex window close`）；保留主代理终端和用户正在使用的资源；不向主代理自己的 block 发送输入。
