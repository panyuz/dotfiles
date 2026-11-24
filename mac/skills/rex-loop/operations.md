# Rex 操作细节

`rex-loop` 的按需参考，默认不读。执行坐标核对、同屏派发、后台 run 操作、通知发送或批量补收时，读对应节。

规则与流程见 [`rex-main-loop.md`](rex-main-loop.md)。本文件只放动态参数、失败分类和字面格式，不写布局算法，也不承担流程权威。

## 1. 坐标核对

```sh
bun "<rex-loop技能目录>/scripts/rex-context.mjs"
```

- 输出含 session、window、block 完整 ID 与当前 tab 布局。
- 退出码 4 表示服务器不可达，资源状态未知。脚本失败时停止依赖坐标的操作，按错误诊断。
- 需要脚本未覆盖的信息时，再查 Rex 原生命令。

## 2. pi-subagents 后台调用

```js
subagent({ agent: "scout", model: "magpie/auto/deepseek-flash:high", cwd: "<任务目录>", task: "<读取或调研任务，含报告和回执绝对路径>", output: "<运行时产物绝对路径>", options: { outputMode: "file-only" } })
subagent({ agent: "worker", model: "magpie/auto/deepseek-flash:high", cwd: "<任务目录>", task: "<文档写作任务，含报告和回执绝对路径>", output: "<运行时产物绝对路径>", options: { outputMode: "file-only" } })
```

- `outputMode: "file-only"` 只保留文件引用。失败和保存错误仍保留常规输出。
- `cwd` 用独立任务目录。子代理不得再派发。

## 3. 同屏派发

```sh
bun "<rex-loop技能目录>/scripts/rex-dispatch.mjs" \
  --session "$REX_SESSION" --main "<主代理block完整ID>" \
  --task-dir "<任务目录绝对路径>" --role "<职责>" \
  --task "<首任务，含报告与回执绝对路径>" \
  [--pane "<本任务已登记代理block>" …] \
  [--worktab "<本任务已登记工作tab>" …] \
  [--worktab-pane "<tab>=<pane>" …]
```

- 只传动态值：session、主代理 block、任务目录、职责、首任务、本任务登记项。未登记的资源不传；脚本不按标签认领 tab。
- 比例、pane 顺序、锚点、满额后走工作 tab 还是新建 tab，全由脚本读实况布局计算。正文不复制这些步骤，也不手填锚点。
- 输出含 `mode`、`block_id`、`anchor`、`panes`、`capacity_left`、`next_action`、`focus`、`created[]`。这些值由脚本算出，不必手填。
- 默认进程参数为 `pi --name "🐙sub｜<职责>" --model magpie/auto/deepseek-flash --thinking high <首任务>`。用 `--arg --model …`、`--arg --thinking …` 覆盖。`requested` 是请求值；实际 provider/model/强度要在启动后核对。
- `--main-window W` 断言主代理 block 所在 tab。`-- /完整命令/` 可替换默认命令。

失败处理：

| 退出码 | code | 动作 |
|---|---|---|
| 0 | `ok` | 已创建并核对，登记坐标 |
| 1 | `usage`、`precheck`、`layout-mismatch`、`unregistered-pane`、`registered-pane-missing`、`label-conflict`、`duplicate-registration`、`cli-missing`、`timeout`、`rex-error`、`protocol-error`、`unknown-error` | 未创建。报 code 与实际布局，不重试 |
| 3 | `resource-not-found` | 目标 block 或 window 不存在；记状态未知，不猜 |
| 4 | `server-unreachable` | 保留资源记录，报告状态未知 |
| 5 | `status-unknown` | 创建已发出、结果不明。保留已知 ID，按坐标核对实际资源，禁止重试与自动清理 |
| 6 | `needs-input` | 预留、未启用。出现时停下问用户 |

部署状态：脚本已随技能部署在 `scripts/`，与 `rex-layout.mjs`、`rex-worktab.mjs` 同目录；它导入这两个文件，不另建 `lib/` 副本。缺件或 `--help` 失败时停止同屏派发并向用户报告缺件，不改用其它分割方式，也不手工推算比例与锚点。

## 4. 后台 run 操作

```js
subagent({ action: "status", id: "<run-id>" })
subagent({ action: "interrupt", id: "<run-id>" })
subagent({ action: "stop", id: "<run-id>" })
subagent({ action: "resume", id: "<run-id>", message: "<补充任务>" })
subagent({ action: "steer", id: "<run-id>", message: "<补充要求>" })
```

- `interrupt` 暂停运行中的 run。用 `status` 确认写入和子进程已停止，记录产物与状态后再交接写入权；状态不明时不交接。
- `stop` 终止 run，之后不能 `resume`。
- `resume` 复用可恢复的 run，沿用原 agent、model 与工具契约。
- `steer` 给运行中的 run 补方向，不新建 run。

## 5. 回报通知命令

只用于 Rex 同屏 peer。四项内容与字面格式见 [`rex-main-loop.md` 第 4 节](rex-main-loop.md)。

```sh
rex send -s "$REX_SESSION" -b "<主代理block完整ID>" '子代理回报｜<任务编号>｜完成｜<一句摘要>｜<报告绝对路径>'
rex send-key -s "$REX_SESSION" -b "<主代理block完整ID>" enter
```

## 6. 回执批量核对（按需入口）

脚本已随技能部署在 `scripts/`：`receipt-check.mjs`、`receipt-protocol.mjs`。对照测试用同目录现有 `wait-report.mjs`，不另存副本；缺件时按 [`references/rex-reports.md`](references/rex-reports.md) 的等待器补收，不得声称本节工具可用。

自检（两个环境变量必须显式给出，无默认值；fixture 放任务 `tmp/`，不写系统 `/tmp`）：

```sh
mkdir -p "<任务目录>/tmp/receipt-fixtures"
cd "<rex-loop技能目录>/scripts"
RECEIPT_TEST_TMP="<任务目录>/tmp/receipt-fixtures" \
WAIT_REPORT_MODULE=./wait-report.mjs \
bun test receipt-check.test.mjs
```

期望 13 pass / 0 fail。缺任一变量应失败，不应静默通过。

同屏派发自检（同样只用任务 `tmp/`）：

```sh
cd "<rex-loop技能目录>/scripts"
mkdir -p "<任务目录>/tmp/dispatch-fixtures"
DISPATCH_TEST_TMP="<任务目录>/tmp/dispatch-fixtures" bun test rex-dispatch.test.mjs rex-probe.test.mjs
bun rex-dispatch.mjs --help
```

部署后的用法（`receipt-check.mjs`）：
```sh
bun "<rex-loop技能目录>/scripts/receipt-check.mjs" \
  --expect <任务ID> <尝试ID> <回执绝对路径> [--expect …] \
  [--wait-ms N] [--report-root <报告根>] [--require-status reported]
```

- `--wait-ms`：1..60000，只等仍缺失的项。
- `--report-root`：只给报告范围提示，越界加 `warnings`，不拒绝。
- `--require-status reported`：把 `blocked`/`failed` 记为未通过（`ok:false`）。
- 输出一行 JSON：`ok`、`protocolComplete`、`taskCompletion`、`attention`、`summary`、`results[]`。只核对协议与元数据，不读报告正文。

四项语义（必读）：

1. `ok:true` 与退出码 0 只表示协议完整，不代表任务成功，也不代表验收。
2. `blocked` 与 `failed` 也是 `match` 与退出码 0；必须看 `attention` 与 `status` 并呈现，不得当成完成。
3. 需要闸门时加 `--require-status reported`，否则 `ok` 不能当通过条件。
4. `watch-error` 是通道问题，不是缺失；回执与报告的权限问题分属 `permission` 与 `report-unreadable`。

| state | 含义 |
|---|---|
| `match` | 回执有效、ID 匹配、报告存在可读；`blocked`/`failed` 也是 `match` |
| `missing` | 未等到回执；带 `--wait-ms` 且等待超时才带 `waited:true` |
| `watch-error` | 监听目录不存在或监听运行失败；不是缺失 |
| `permission` | 回执读取 EACCES/EPERM；报告的权限问题见 `report-unreadable` |
| `invalid-json`、`invalid-field`、`invalid-status`、`invalid` | 格式不合规，或不是普通文件 |
| `too-large` | 达到或超过 64 KiB |
| `id-mismatch`、`duplicate` | ID 不符，或同路径、同任务加尝试重复 |
| `report-missing`、`report-unreadable`、`report-not-file` | 报告元数据问题，含报告无权限 |

退出码：0 = 全部 `match`（含 `blocked`/`failed`，协议完整）；1 = 存在待处理或协议问题，或 `--require-status` 未满足；2 = 参数错误。

`late:true` 表示回执在本次 `--wait-ms` 等待窗口内迟到到达；按历史证据处理，不当新结果。核对结果不替代报告读取与验收。
