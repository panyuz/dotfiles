## xd:// Tool Invocation Rule (CRITICAL)

The following tools are **xd:// virtual devices** and MUST be invoked through the `write` tool, NOT as direct tool calls:

- `web_search` → `write("xd://web_search", JSON.stringify({query: "...", ...}))`
- `ast_edit` → `write("xd://ast_edit", ...)`
- `debug` → `write("xd://debug", ...)`
- `lsp` → `write("xd://lsp", ...)`
- `browser` → `write("xd://browser", ...)`

Attempting to call these as direct named tools will result in `Tool ... not found`. ALWAYS use the `write` tool with the `xd://` path on first attempt — do NOT try the direct tool call first and then fall back.

## Git Push Failure Rule (CRITICAL)

If `git push` fails (authentication/network/any error): **STOP immediately**. Do not retry, do not switch remotes/protocols, do not try other SSH keys or paths. Remind the user to unlock KeepassXC and ask them to confirm before continuing.

## macOS 全局安装禁令 (CRITICAL)

**禁止向本机 macOS 系统全局安装任何包、依赖或库**，包括但不限于：

- `pip install` / `pip3 install`（系统 Python）
- `npm install -g` / `bun add -g` / 任何全局 Node 包
- `brew install` / 其他系统级包管理器
- 修改系统 Python、Node 环境的任何操作

只允许使用项目级、隔离环境的工具：

- Python：一律通过 `uv run`（或项目 `.venv` 内已有环境）执行；新增依赖先 `uv add` 写入项目 `pyproject.toml`
- Node：一律通过 `bun` / `bunx`（或 `npx`）在项目目录内执行；依赖写入项目 `package.json`，禁止 `-g` 全局安装
- 临时脚本如确实需要第三方库且项目未依赖：优先换用标准库实现；无法实现时先向用户说明，经确认后用 `uv run --with` 临时隔离运行，仍不得装入系统环境
