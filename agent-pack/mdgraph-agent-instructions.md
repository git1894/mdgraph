# MDGraph Agent Instructions

Use MDGraph before reading multiple Markdown files manually.

- Start with `mdgraph_status` if index availability is unclear.
- Use `mdgraph_context` for cross-document design, ADR, runbook, API, incident, source-ref, or feature-chain questions. Include `knownFiles` and `maxChars` when the host supports MCP arguments.
- Use `mdgraph_search` for quick keyword, entity, path, command, config key, API route, or error-code lookup.
- Use `mdgraph_node` for known document paths, section anchors, entities, source paths, or graph ids.
- Use `mdgraph_trace` for relationship questions between two known documents, entities, or source references.
- Prefer returned context when it includes enough content, reasons, provenance, source refs, and risk notes.
- Fall back to normal file reads when MDGraph is inactive, stale for the task, too sparse, or when exact source text is required.

Do not treat MDGraph as hidden memory, a source AST index, or an authority beyond the indexed Markdown corpus. Do not create or update an index unless the user asks for it.