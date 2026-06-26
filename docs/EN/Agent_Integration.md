# MDGraph Agent Integration

This guide is the shared 0.3 integration contract for coding agents. Host-specific setup should stay thin: start the same MCP server, expose the same five tools, and teach the agent when to query MDGraph before reading Markdown files directly.

## Core Behavior

Use MDGraph as an invited documentation context layer, not as hidden memory and not as a source-code graph.

1. Check `mdgraph_status` when you are not sure whether the workspace is indexed.
2. Use `mdgraph_context` for cross-document questions about designs, ADRs, runbooks, API docs, source references, incidents, or feature chains. Pass MCP `knownFiles` when the task already names relevant project-relative docs or source paths, and `maxChars` when the agent has a tight context budget.
3. Use `mdgraph_search` for quick keyword, entity, path, command, config key, API route, or error-code lookup.
4. Use `mdgraph_node` when you already know a document path, section anchor, entity name, source path, or graph id.
5. Use `mdgraph_trace` for relationship questions such as how a design depends on an ADR or how a source path connects to a runbook.
6. Read raw files only when the index is unavailable, the returned context is insufficient, exact neighboring prose is required, or the user explicitly asks for file-level inspection.

For coding tasks, include the task text in the `mdgraph_context` query and pass any known file paths through `knownFiles`. This gives MDGraph enough signal to return a task-start documentation brief with relevant docs, source refs, risk notes, provenance, deterministic auto-mode metadata, and `suggestedNextQueries`.

## Shared Instruction Template

```text
Use MDGraph before reading multiple Markdown files manually.

- Start with mdgraph_status if index availability is unclear.
- Use mdgraph_context for cross-document design, ADR, runbook, API, incident, source-ref, or feature-chain questions. Include knownFiles and maxChars when the host supports MCP arguments.
- Use mdgraph_search for quick keyword/entity/path lookup.
- Use mdgraph_node for known document paths, section anchors, entities, source paths, or graph ids.
- Use mdgraph_trace for relationship questions between two known documents, entities, or source references.
- Prefer returned context when it includes enough content, reasons, provenance, source refs, and risk notes.
- Fall back to normal file reads when MDGraph is inactive, stale for the task, too sparse, or when exact source text is required.

Do not treat MDGraph as hidden memory, a source AST index, or an authority beyond the indexed Markdown corpus.
```

## MCP Configuration

Use the same stdio command in MCP-capable clients:

The same instructions, host examples, config example, and prompt templates are also shipped in [`agent-pack/`](../../agent-pack/).

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

Run these once for the target project before relying on the server:

```bash
node /absolute/path/to/mdgraph/dist/bin/mdgraph.js init --docs "docs/**/*.md"
node /absolute/path/to/mdgraph/dist/bin/mdgraph.js index
```

## Host Notes

| Host | Setup shape | Fallback guidance |
|---|---|---|
| Claude Code | Add the MCP server to the project or user MCP config, then add the shared instruction template to project instructions. | If `mdgraph_status` is inactive, continue with normal file tools unless the user asks to index. |
| Cursor | Add the same stdio server in Cursor's MCP settings and keep the shared instruction in project rules. | Use MDGraph for Markdown context; use editor search/source reads for implementation details. |
| Copilot Chat | Add the MCP server where MCP is available and keep the shared instruction in `.github/copilot-instructions.md` or equivalent workspace guidance. | If MCP tools are unavailable, use `mdgraph` CLI manually only when the user asks. |
| Codex CLI | Add the stdio MCP server to the Codex MCP configuration and keep this guide in repo instructions. | Query MDGraph before broad documentation reads; fall back to shell/file tools when unindexed. |
| Generic MCP client | Use the JSON block above. | Treat tool results as documentation context with explicit provenance, not as code execution evidence. |

## Suggested Workflows

Task-start documentation brief:

1. `mdgraph_status`
2. `mdgraph_context` with the task text, `knownFiles`, and `maxChars` when the host budget is tight
3. `mdgraph_node` or raw file reads only for the exact documents that still need inspection

Relationship question:

1. `mdgraph_search` for each side if names are fuzzy
2. `mdgraph_trace` between the resolved nodes
3. `mdgraph_context` for surrounding sections if the trace path needs explanation

Documentation health check:

1. `mdgraph_status`
2. CLI `mdgraph doctor --json` when the user asks for docs health or CI gating
3. Raw file edits only after the doctor output names affected documents

## Current Limits

- MDGraph indexes Markdown documents, not source ASTs or arbitrary files.
- The MCP surface intentionally stays at five tools: search, context, node, trace, and status.
- Agent auto mode is deterministic and narrow: MCP search/context choose default limit, depth, and character budget from query shape, index size, `knownFiles`, and `maxChars`. Token-specific host budgets should still be handled by the agent or client.
- `mdgraph_status` performs a lightweight Markdown path and mtime freshness check. Use `mdgraph doctor --json` for full stale-index hashing and documentation health conclusions.
- Scoped file-read comparison case notes are recorded in [Agent_File_Read_Comparison.md](Agent_File_Read_Comparison.md). Use `mdgraph report --benchmark <file>` for structured with/without-MDGraph run-record deltas; full transcript capture and agent runtime hosting remain outside MDGraph.
