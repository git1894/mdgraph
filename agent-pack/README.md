# MDGraph Agent Pack

This pack contains reusable guidance for MCP-capable coding agents. It keeps host-specific setup thin: each host starts the same MDGraph MCP server and uses the same query-first, file-read-second behavior.

## Files

- `mdgraph-agent-instructions.md`: shared instruction template for project rules or agent guidance.
- `mcp-config.example.json`: stdio MCP server configuration template.
- `host-examples.md`: host-specific setup notes for Claude Code, Cursor, Copilot Chat, Codex CLI, and generic MCP clients.
- `prompts/task-start-context.md`: prompt template for task-start documentation briefs.
- `prompts/relationship-trace.md`: prompt template for relationship and dependency questions.
- `prompts/status-doctor.md`: prompt template for readiness, stale-index, and documentation health checks.

## Host Placement

| Host | Suggested placement |
|---|---|
| Claude Code | Project/user instructions plus MCP config. |
| Cursor | Project rules plus MCP settings. |
| Copilot Chat | `.github/copilot-instructions.md` or equivalent workspace guidance plus MCP config when available. |
| Codex CLI | Repo instructions plus Codex MCP config. |
| Generic MCP client | Import the MCP config and instruction text directly. |

Replace `/absolute/path/to/mdgraph/dist/bin/mdgraph.js` and `/absolute/path/to/project` in `mcp-config.example.json` before use.