# pi 交互实战（herdr pane 里跑 pi）

本文记在 herdr pane 里跑 pi 的本机口径。herdr 的命令语义真源是官方 `SKILL.md`。派发节奏、状态语义、轮询间隔见 `agent-dispatch.md`。

## 模型 id

- pi 的模型注册表在 `~/.pi/agent/models-store.json`。当前 provider：`deepseek`、`kimi-coding`、`ollama-cloud`、`qwen-token-plan-cn`、`typesafe`、`zai-coding-cn`。
- 查一个 provider 的 id 全集：`jq -r '.["ollama-cloud"].models[].id' ~/.pi/agent/models-store.json`。
- WARNING：ollama-cloud 的 id 不带 `:cloud` 后缀，库内注册的是 `kimi-k3`。传 `ollama-cloud/kimi-k3:cloud` 会警告 `Model not found for provider. Using custom model id`。它虽能跑，但不是注册模型，计费与上下文配置不保证。
- 启动后核对状态栏：`(ollama-cloud) kimi-k3 • medium`。看到 `Warning: Model not found` 就是 id 错了。
- 不要借用别的 harness 的 id。omp 已弃用，它的凭据与 id 体系与 pi 不相通。

## 启动与派发

```bash
herdr pane run <pane> "pi --model <provider/model>"   # 启动，4 秒就绪
sleep 4
herdr pane send-text <pane> "$(cat /abs/path/role-prompt.md)"
herdr pane send-keys <pane> enter
```

WARNING：角色提示词必须整份发送。只发任务数据、不发人设，产出的分析会缺角色视角。2026-08-28 实测因此返工。人设与数据写在同一个文件里，一次发出。

## 退出

1. `/quit` 加 enter。最干净。回到 shell 时会提示 `pi --session <id>` 这个恢复命令。
2. esc，然后 ctrl+c 两次，共三次。前两次清任务态，第三次退出。
3. 思考中按 ctrl+c 只中断当前轮，agent 还在。确认退出看状态栏消失、回到 shell 提示符。

WARNING：`/exit` 不是退出命令。pi 会把它当对话内容，回一句「我无法直接退出会话」。

pi 没有 yolo 参数。读多写少的任务（分析类）直接 prompt 就行。写文件的任务要在会话内批准。

## agent 注册与识别

- `herdr agent start --kind pi --pane <pane>` 可对**已运行**的 pi 注册名字。空 argv 也能识别，缺省模型是上次启动所用。
- pi 退出后 `agent get <name>` 返回 None。重启后名字失效，要重新注册。也可以直接用 `pane send-text` 交互，pi 的识别不依赖注册名。
- 会话恢复：`pi --session <id>`。

## pi 作为调用方

pi 主会话可以通过 herdr CLI 编排别的 agent。实测口径（2026-08-30，INVEST 项目的只读迁移评审）：

- 启动：`herdr agent start <name> --kind pi --pane <空 shell pane>`。4 秒就绪。
- 提交：`agent prompt --wait` 对 pi 也会 timeout 或 stalled。**要无条件补 `send-keys enter`**。实测两次派发都需要。
- 状态陷阱：prompt 返回的 `agent_status=done` 可能是上一轮的残留。判断本轮是否真开工，用 `agent read` 看现场。
- 多轮复用：同一个会话可以做「评审 → 修复 → 复检」三轮 prompt 加 enter，上下文延续。复检轮可直接引用首轮发现。
- 读产出：`agent read --source recent-unwrapped --lines N`。报告长就加大 `--lines` 分段取。
- 只读评审的提示词要含四件：自包含的角色、逐条核查的命令清单、证据要求（命令加关键输出）、输出格式（blocker / minor / note，加 PASS 或 FAIL）。实测这样抓到过真 blocker。

## 与 ask_advisor 的分工

`ask_advisor` 扩展工具做 one-shot 无状态咨询。它快、省，结果直达上下文。herdr 常驻会话做多轮、连续、过程可见的协作。常规咨询用前者，连续编排用后者。

只吃 prompt 内静态数据的 panel，结论偏激进。能自己拉数据的 agent 更保守。2026-08-28 同题实测确认过这个差别。
