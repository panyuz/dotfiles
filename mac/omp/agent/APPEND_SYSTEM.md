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
