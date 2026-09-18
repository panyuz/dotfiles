# MCP 配置实战笔记（2026-08-16 实测：agy，项目级安装）

> 场景：为 herdr pane 内的 agy（Antigravity CLI）接入 beaver-zotero MCP
> （Zotero 文献库，HTTP 端点 `http://localhost:23119/beaver/mcp`，Beaver 插件内嵌）。
> 结论先行：**一律装项目级，不装全局**（用户明确要求）。

## 通用要点

- beaver-zotero 是 Streamable HTTP MCP（protocolVersion 2024-11-05），agy 原生支持
- 端点探测：`curl -X POST http://localhost:23119/beaver/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}'`
- 配置后**必须重启 agent 会话**才生效（新会话加载 MCP；运行中会话不注册新增 server）

## agy（Antigravity CLI 1.1.13）

### 配置位置

- 全局：`~/.gemini/config/mcp_config.json`（不推荐，用户要求项目级）
- **项目级：`.agents/mcp_config.json`**（工作区根目录；旧版 `.antigravitycli/mcp_config.json` 有 bug 会被忽略，见 google-antigravity/antigravity-cli issue #60）
- 远程连接用 **`serverUrl`** 字段（Streamable HTTP / SSE）；legacy 的 `url`/`httpUrl` 不支持
- 官方文档：https://antigravity.google/docs/mcp ；本机 agy 自带：`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/mcp_servers.md`

### 配置内容（beaver-zotero 实测）

```json
{
  "mcpServers": {
    "beaver-zotero": {
      "serverUrl": "http://localhost:23119/beaver/mcp"
    }
  }
}
```

### 验证

1. 重启 agy（退出 ctrl+c ×2 → 回 shell → `herdr agent start`）
2. 在 agy 内打开 MCP Manager：`herdr pane send-text <pane> "/mcp"` + `herdr pane send-keys <pane> enter`
3. 界面显示 `✓ beaver-zotero  Tools: search_by_topic, search_by_metadata, ...` 即成功；enter 进 Actions（Restart/Disable），esc 退出

### 陷阱

- agy 启动时会自动创建**空的全局** `~/.gemini/config/mcp_config.json`（0 字节占位，无 server 定义，无害）——不要误以为全局配置被写回
- MCP 工具调用在输出中显示为 `● beaver-zotero/search_by_metadata(...)` 步骤行，可据此核查 agent 是否真的用了 MCP
- agy 的全局配置里没有 beaver-zotero 定义，是正常的（**一律项目级**）；全局那个空占位文件勿删勿慌
