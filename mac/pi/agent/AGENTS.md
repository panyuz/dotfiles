# 全局指令

## 工具使用

- 搜索优先内置 `grep` / `find` 工具(一次调用支持多词 OR);内置工具覆盖不了的操作才走 bash
- 定位后用 `read` 的 `offset`/`limit` 只读命中附近;工作区外已知文件直接 `read` 绝对路径

## 本机规则(macOS)

- git 远程操作失败(push/pull,SSH 权限类):立即停止,不重试、不换 remote/协议、不试其它 SSH key;提醒解锁 KeePassXC 并等确认
- 禁止系统级安装(`pip install`、`npm -g`、`brew install` 等);Python 用 `uv`,Node 用 `bun`/`bunx`/`npx` 项目内执行
