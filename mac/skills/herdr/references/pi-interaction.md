# Pi (pi CLI) 交互实战（2026-08-28 实测）

Pi 是独立的 coding agent CLI（会话存 `~/.pi/agent/sessions/`），与 omp 是不同实现、配置体系完全分开。在 herdr pane 里跑 pi 并指定模型。

## 模型 id 踩坑（必读）

- pi 的模型注册表在 `~/.pi/agent/models-store.json`（providers: deepseek / ollama-cloud）。**ollama-cloud 库内注册的 id 是 `kimi-k3`，不带 `:cloud` 后缀**——传 `ollama-cloud/kimi-k3:cloud` 会警告 `Model not found for provider. Using custom model id`，虽能跑但不是注册模型（计费/上下文配置不保证）。
- omp 的 ollama-cloud 凭据存在 `~/.omp/agent/agent.db`（auth_credentials 表），**pi 不读它**——pi 用 npm 扩展 `pi-ollama-cloud`（`~/.pi/agent/settings.json` extensions 列表）+ ollama.com API key。两套配置互不相通，别拿 omp 的模型 id 直接套 pi。
- 启动后核对状态栏：`(ollama-cloud) kimi-k3 • medium`——出现 `Warning: Model not found` 即 id 错了。
- omp 的 deepseek provider 注册 id 是 `deepseek-v4-pro`（fuzzy `deepseek-v4-pro` 可用），与 models-store 的 `deepseek-v4-pro:0813` 略有出入——`pi --model deepseek/deepseek-v4-pro` 实测匹配成功，状态栏显示 `(deepseek) deepseek-v4-pro • high`。
- 查注册模型全集：`python3 -c "import json; [print(m['id']) for m in json.load(open('/Users/<user>/.pi/agent/models-store.json'))['ollama-cloud']['models']]"`

## 启动 + 派发完整角色提示词

```bash
herdr pane run <pane> "pi --model <provider/model>"   # 启动（4s ready）
sleep 4
herdr pane send-text <pane> "$(cat /abs/path/role-prompt.md)"   # 角色人设+数据一起发
herdr pane send-keys <pane> enter                                # 补 enter 提交
```

⚠️ **角色提示词必须完整发送**——只发任务数据不发人设，产出的分析会缺角色视角（2026-08-28 实测返工）。角色提示词 + 数据写在同一个文件里一次发出。

## 退出 pi（三种方式实测）

1. `/quit` + enter（最干净，回 shell 并提示 `pi --session <id>` 恢复命令）
2. esc → ctrl+c → ctrl+c（三次；前两次清任务态，第三次退出）
3. ctrl+c 两次在思考中会先中断当前轮，agent 还在——确认退出看状态栏消失、回 shell `❯`

- ⚠️ `/exit` 不是退出命令——pi 会把它当对话内容回复"我无法直接退出会话"（实测）。
- ctrl+c 在思考中只中断当前轮；agent 存活状态用 `herdr agent get <name>` 看 agent_status。
- pi 没有 yolo 模式参数时，读多写少任务（分析类）直接 prompt 即可；写文件任务需在会话内批准。

## agent 识别

- `herdr agent start --kind pi --pane <pane>` 可对**已运行**的 pi 注册名字（空 argv 也能识别，缺省模型即上次启动所用）。
- pi 退出后 `agent get <name>` 返回 None；重启后名字失效，需重新注册或直接用 `pane send-text` 交互（pi 识别不依赖注册名）。
- 会话恢复：`pi --session <id>`（退出时提示）。

## 深浅对照：Pi panel vs omp subagent（同 prompt 双通道实测）

| 维度 | Pi panel（prompt 即答） | omp subagent（read/bash 可用） |
|---|---|---|
| 数据深度 | 只吃 prompt 内静态数据 | 会自算赛道动量/分位/横截面 |
| 结论倾向 | 与 subagent 收敛，档位略激进 | **更保守**（多了数据验证层） |
| 可见性 | herdr panel 内可见、可续聊多轮 | 后台一次性快照，追问重发上下文 |
| 适用 | 盘感类分析、需要向用户展示过程 | 要数据深度的正式评估 |

实测案例：同一收盘数据 + 同角色提示词，Pi 版老刀给"sleeve 半解冻试 ¥5,000"，subagent 版老刀"volume 补齐前只够试仓级别"——subagent 多拉一层数据后明显更谨慎。四实例（2 模型 × 2 通道）对大盘定性判断完全收敛，说明结论稳健。
## Pi 作为调用方（caller 侧）——pi 会话经 herdr 编排其他 agent（2026-08-30 实测）

场景：pi 主会话（INVEST 项目）通过 herdr CLI 向另一 pane 的 pi 面板派发只读迁移评审任务（评审员 deepseek-v4-pro）。

- **启动**：`herdr agent start pi-review --kind pi --pane <空shell pane>`——空 argv 缺省模型 = 用户 defaultModel，4s ready。
- **提交**：`agent prompt --wait` 对 pi 同样出现 timeout/stalled → **无条件补 `send-keys enter`**（与 kimi 同款，实测两次派发皆需）。
- **状态语义陷阱**：prompt 返回的 `agent_status=done` 可能是上一轮残留——判断本轮是否真开工用 `agent read` 看现场，别只信状态字段。
- **多轮复用**：同一 pi-review 会话「评审 → 修复 → 复检」三轮 prompt+enter，上下文延续（复检轮直接引用首轮发现，无需重发背景）。
- **产出读取**：`agent read --source recent-unwrapped --lines N`；评审报告较长时加大 `--lines` 分段取。
- **派发前核对模型注册**：`~/.pi/agent/models-store.json` 的 provider/models/id——ollama-cloud 库 `kimi-k3` 为裸 id（无 `:cloud` 后缀），带后缀会 Model not found 降级 custom id。
- **只读评审提示词设计**：角色自包含 + 逐条核查命令清单（让评审员真跑命令出证据）+ 证据要求（命令+关键输出）+ 输出格式（blocker/minor/note + PASS/FAIL 结论）——本次评审真抓到 blocker（omp 专属 API `pi.logger`/`pi.sessionManager` 在 pi ExtensionAPI 不存在，迁移扩展原样搬运会运行时抛错）。
- **与 ask_advisor 扩展工具的分工**：扩展工具 = one-shot 无状态咨询（快、省、结果直达上下文）；herdr 常驻 = 多轮/连续/过程可见（重、可追问）。前者做常规咨询，后者做连续协作与编排。
