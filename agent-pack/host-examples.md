# MDGraph Host Examples

These examples all start the same stdio MCP server. Keep the shared behavior model in `mdgraph-agent-instructions.md`; only the host placement differs.

Replace both absolute paths before use:

- `/absolute/path/to/mdgraph/dist/bin/mdgraph.js`
- `/absolute/path/to/project`

## Claude Code

Use the shared MCP JSON shape in the Claude Code MCP configuration for the project or user profile. Put the contents of `mdgraph-agent-instructions.md` in project instructions.

```json
{
  "mcpServers": {
    "mdgraph": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/mdgraph/dist/bin/mdgraph.js",
        "serve",
        "--mcp",
        "--path",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

## Cursor

Add the same MCP server entry in Cursor's MCP settings. Put the shared instruction text in project rules so the agent queries MDGraph before broad Markdown reads.

```json
{
  "mcpServers": {
    "mdgraph": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mdgraph/dist/bin/mdgraph.js", "serve", "--mcp", "--path", "/absolute/path/to/project"]
    }
  }
}
```

## Copilot Chat

When MCP tools are available in the host environment, use the same stdio server entry. Put the shared instruction text in `.github/copilot-instructions.md` or the workspace guidance surface used by the project.

If MCP is unavailable, do not simulate hidden memory. Use normal file tools, or run MDGraph CLI commands only when the user asks.

## Codex CLI

Add the same stdio server entry to the Codex MCP configuration. Keep `mdgraph-agent-instructions.md` in repository instructions or the agent's project guidance.

Use `knownFiles` and `maxChars` with `mdgraph_context` when the task already names files or the context budget is tight.

## Generic MCP Client

Use `mcp-config.example.json` directly. The server exposes exactly five tools:

- `mdgraph_search`
- `mdgraph_context`
- `mdgraph_node`
- `mdgraph_trace`
- `mdgraph_status`

If `mdgraph_status` reports inactive, fall back to normal file reads unless the user explicitly asks to create or refresh the index.