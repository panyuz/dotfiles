# MCP 配置实战笔记（2026-10-07 复核到 agy 1.3.0）

> 场景：为 herdr pane 内的 agy（Antigravity CLI）接入 MCP。首个案例是 beaver-zotero（Zotero 文献库，HTTP 端点 `http://localhost:23119/beaver/mcp`，Beaver 插件内嵌）。
> 口径（2026-10-07 更新）：**能项目级就项目级**。但 agy 的项目级载体是**插件**，不是裸的 `mcp_config.json`。

## 官方只认两处

| 层级 | 路径 | 出处 |
|---|---|---|
| 全局 | `~/.gemini/config/mcp_config.json` | 官方 MCP 页，加 agy 1.3.0 自带文档 |
| 插件（项目级用这个） | `<仓库>/.agents/plugins/<名字>/mcp_config.json` | 官方 plugins 页：工作区插件放 `.agents/plugins/` |

工作区插件还要一个 `plugin.json`。CLI 下 `name` 字段必须有：

```json
{ "$schema": "https://antigravity.google/schemas/v1/plugin.json", "name": "writing-mcp" }
```

### 旧写法：别依赖

- `<仓库>/.antigravitycli/mcp_config.json`：agy 1.0 会读文件名，但**静默忽略** `mcpServers`（issue #60，仍 open）。
- `<仓库>/.agents/mcp_config.json`：社区变通。本机 1.1.13 实测可用；有人在 1.1.3 报回归（HOME 有配置时只加载 HOME）。1.3.0 自带文档没有这条路。
- 结论：先用插件。要用旧写法，先实测再信。

## 字段（agy 侧）

| 字段 | 说明 |
|---|---|
| `command` / `args` / `env` / `cwd` | stdio 传输 |
| `serverUrl` | 远程。官方页用这个键；1.3.0 自带文档写 `url`，并说 `serverUrl` 也兼容。两个都认 |
| `headers` | 远程的 HTTP 头。只收**字面值**。没有 pi 的 `!command` 与 `${VAR}` 取值 |
| `disabled` | 停用而不删。注意 pi 叫 `enabled`，名字与语义都相反 |
| `disabledTools` | 把指定工具藏起来（只做减法） |
| `oauth` / `authProviderType` | OAuth 客户端；`google_credentials` 走 ADC |

## agy 的 MCP 与插件命令

```bash
agy mcp list                        # 列出生效的 server。在仓库根跑
agy mcp add|remove|enable|disable   # 只能写全局
agy plugin validate <插件目录>       # 校验 plugin.json 与 mcp_config.json
agy plugin list
```

WARNING：`agy mcp add` **没有 scope 参数**，只写全局。项目级 MCP 必须手写文件。

WARNING：`agy mcp list` 在任意目录都会列出全局配置。**别把它当项目级生效的证据**。要看来路就查日志 `~/.gemini/antigravity-cli/log/cli-*.log`。

`agy plugin validate` 会逐项报进度（2026-10-07 实测输出）：

```
[ok]    <目录>
        - skills      : skipped (not found)
        ✔ mcpServers  : 1 processed
        - hooks       : skipped (not found)
```

JSON 写坏会当场报错，例如字符串里混入字面 `\n` 时报 `invalid character '\n' in string`。

## beaver-zotero 端点探测

```bash
curl -X POST http://localhost:23119/beaver/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}'
```

## 验证

1. 写完插件先跑 `agy plugin validate <目录>`。
2. 重启 agy：退出 ctrl+c ×2 → 回 shell → `herdr agent start`。**配置改动后必须重启会话**。
3. `agy mcp list`，或在 agy 内 `/mcp` 看 `✓ <名字>  Tools: ...`。
4. MCP 调用在输出里显示为 `● beaver-zotero/search_by_metadata(...)` 步骤行。用它核查 agent 是否真用了 MCP。

## 陷阱

- agy 启动时会自动创建**空的全局** `~/.gemini/config/mcp_config.json`。不要误以为项目配置被写回，也不要删它。
- 全局配置在**每个**会话都加载，与项目无关。2026-10-07 本机状态：全局有 `drawio`（stdio）与 `zotseek`（http），两个都 `disabled`。这与最初「一律项目级」的口径不一致，待迁。
- 远程 server 用 Streamable HTTP 端点（常以 `/mcp` 结尾）。旧的 HTTP+SSE 传输不支持。

## 出处

- 官方 MCP 页：https://antigravity.google/docs/mcp
- 官方 plugins 页：https://antigravity.google/docs/plugins
- agy 自带文档：`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/mcp_servers.md`
- 项目级 MCP 的 bug：https://github.com/google-antigravity/antigravity-cli/issues/60
