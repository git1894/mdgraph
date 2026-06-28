# MDGraph Agent Instructions

Use MDGraph as the first stop for documentation work, before reading multiple Markdown files manually.

Default order for Markdown/documentation questions:

1. Start with `mdgraph_status` if index availability or freshness is unclear.
2. Use `mdgraph_context` first for task-start context when the task touches architecture, roadmap, public contracts, CLI/MCP behavior, release process, docs policy, ADRs, runbooks, incidents, source_refs, or cross-document feature chains.
3. Use `mdgraph_search` for exact docs keyword, entity, path, command, config key, API route, or error-code lookup before raw grep or manual file reads.
4. Use `mdgraph_node` or `mdgraph_trace` after search/context narrows the target.
5. Fall back to normal file reads or text search only when MDGraph is inactive, stale for the task, too sparse, exact neighboring prose is required, or the user explicitly asks for file-level inspection.

- Start with `mdgraph_status` if index availability is unclear.
- Use `mdgraph_context` for cross-document design, ADR, runbook, API, incident, source-ref, or feature-chain questions. Include `knownFiles` and `maxChars` when the host supports MCP arguments.
- Use `mdgraph_search` for quick keyword, entity, path, command, config key, API route, or error-code lookup.
- Use `mdgraph_node` for known document paths, section anchors, entities, source paths, or graph ids.
- Use `mdgraph_trace` for relationship questions between two known documents, entities, or source references.
- Prefer returned context when it includes enough content, reasons, provenance, source refs, and risk notes.
- Fall back to normal file reads when MDGraph is inactive, stale for the task, too sparse, or when exact source text is required.

Do not treat MDGraph as hidden memory, a source AST index, or an authority beyond the indexed Markdown corpus. Do not create or update an index unless the user asks for it.