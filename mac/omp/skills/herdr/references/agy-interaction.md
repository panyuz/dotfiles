# agy（Antigravity CLI）交互实战笔记（2026-08-10 实测）

> 场景：herdr pane 内启动 `agy`，通过 `herdr agent start --kind agy` 托管，`herdr agent prompt` 发任务（阅读行情/舆情文件并给投资建议）。

## 启动方式（已验证）

```bash
herdr agent start <name> --kind agy --pane <pane-id> -- --dangerously-skip-permissions
```

- `--dangerously-skip-permissions` = yolo 等价物（自动批准工具权限请求；agy 交互 TUI 下 herdr 的 prompt/read 走 agent 通道，读文件无需逐次审批）。
- 本机 agy 位于 `~/.local/bin/agy`，账号 smartpanyu@gmail.com（Google AI Pro），默认模型 Gemini 3.6 Flash (High)。
- 交互提示符为 `>`；`?` 查看快捷键。

## 陷阱 1：首次启动卡账号资格验证（已复现）

**症状**：启动后横幅下方出现

```
⚠ Verifying your account...
  ⎿  We're finishing verifying your account eligibility.
     This usually takes a moment. Please try again shortly.
```

此状态下**输入框是空的，`herdr agent prompt` 的粘贴内容不会落地**（agent 状态回 `done`=idle，但没有任何输出）——提示词静默丢失，不是排队。

**修复**（实测有效）：重启一次即通过。
```bash
herdr agent send-keys <name> ctrl+c     # 第一次：进入 "press ctrl+c again to exit" 确认态
herdr agent send-keys <name> ctrl+c     # 第二次：真正退出，回 shell 提示符
# 等 pane 回到 shell prompt（agent start 要求 pane 必须处于交互 shell 提示符）
herdr agent start <name> --kind agy --pane <pane-id> -- --dangerously-skip-permissions
```
- 若第二次 ctrl+c 后立刻 `agent start`，会因 pane 还在退出确认态而失败（非 JSON 错误、exit code 5）——先读 pane visible 确认已回 `❯` 再重启。

## 陷阱 2：验证横幅期间发 prompt = 白费

prompt 需在横幅消失、出现干净 `>` 提示符后发送。判断就绪：`herdr agent read <name> --source visible` 看不到 "Verifying your account" 字样。

## prompt 流程（已验证可用）

```bash
herdr agent prompt <name> "<任务>" --wait --timeout 20000
herdr agent send-keys <name> enter      # 补发 Enter（与 kimi 同法，无害；agy 本次直接提交成功）
herdr agent wait <name> --timeout 300000
herdr agent read <name> --source recent-unwrapped --lines 100   # 读全文
```

- agy 回复在 TUI 内渲染，`recent-unwrapped` 可完整读到（本次 800 字建议全文拿到，无需写文件 fallback）。
- 长任务后状态 `done` = 回复完成回到 idle。

## 其他观察

- 任务中读文件会显示 `● Read(/abs/path)` 步骤行（8 个文件并行读，~5s）。
- 会话恢复：`--continue`（最近会话）/ `--conversation <id>`；单发模式：`-p/--print`。
- 未验证：`--model` 切换、`--sandbox`、`agent` 子命令列表——需要时查 `agy --help`。
