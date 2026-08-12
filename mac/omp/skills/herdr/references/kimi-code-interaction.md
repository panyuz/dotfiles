# kimi code 交互实战笔记（2026-08-04 实测，5 次复现）

## 症状

- `herdr agent prompt <name> "<任务>" --wait` 返回 `agent_prompt_stalled`（error code），尽管 agent 处于 `idle` 且 prompt 文本已出现在 pane 输入框
- kimi 停在 `>` 提示符，`terminal_title` 不更新，`state_change_seq` 不变
- 已确认**可复现**：2026-08-04 连续 5 次 prompt 全部 stalled

## 根因

- kimi code（Kiro TUI）收到 bracketed-paste 大段文本后，Herdr 原子发送的编码 Enter **不触发提交**——输入框停在待提交状态
- `agent_prompt_stalled` 是 Herdr 的准确报警（5 秒内无 lifecycle 变化），**不是 Herdr bug**，是 kimi kind 的 paste 处理差异
- 补发一次原始 Enter（走不同通道）可正常提交

## 修复流程（实战验证）

```bash
herdr agent prompt <name> "<任务>" --wait --timeout 180000   # 大概率返回 agent_prompt_stalled
herdr agent send-keys <name> enter                            # 补发 Enter → 触发提交
herdr agent wait <name> --timeout 240000                      # 等待完成（idle = 就绪）
herdr agent read <name> --source recent-unwrapped --lines 60  # 读输出
```

或直接：**prompt 后无条件补 `send-keys enter`**（不等待 stalled），省一轮。

## 注意

- **不要按 `esc`**：会打断已提交的 prompt（界面显示 `Interrupted by user`），该次文本作废
- 补 Enter 后 3-10 秒内 `state_change_seq` 变化（如 51→57）即提交成功，进入 `working`
- kimi 长输出在 alternate screen：`recent-unwrapped` 拿不到的行数，让它把完整回复写入临时文件再读（见 SKILL.md 主文 fallback）
- kimi 的 `working` 输出会先显示「● 读文件/搜索」步骤再给结论——`wait` 到 `idle` 再 `read`
- prompt 会显示在输入框区域但界面 tip 行变化（🌕/🌑）不代表提交成功——以 `agent get` 的 `state_change_seq` 为准

## 诊断命令

```bash
herdr agent get <name>                                    # agent_status / state_change_seq / revision
herdr agent read <name> --source detection --lines 20     # 底部缓冲：确认输入框是否有文本
herdr agent read <name> --source recent-unwrapped --lines 10   # 最近输出：确认是否已在 working
```

## 退出与恢复（2026-08-10 实测）

- **退出：`/exit` + Enter**（`herdr pane send-text <pane> /exit` 后补 enter）——ctrl+d **无效**（TUI 不响应 EOF）
- 退出时界面显示恢复命令：`kimi -r session_<id>`（先 `agent read --source visible` 记下 session id）
- 长输出（swarm 子代理模式）：`recent-unwrapped` 只能读到 alternate screen 外的可见部分（出现 `ctrl+o to expand` 提示）——分多段读或让 agent 把完整回复写入临时文件再 read
- 每轮 `prompt --wait` 12-15s 超时返回 timeout 错误属正常（文本已发出，补 enter 即提交），非失败；等待完成用 `agent wait --timeout 300000`（实测 90-280s）
