export const SERVER_INSTRUCTIONS = `# MDGraph — Markdown document graph for coding agents

MDGraph indexes project Markdown into a local SQLite graph: documents, sections,
entities, source references, and semantic edges such as DEFINES, DEPENDS_ON,
LINKS_TO, IMPLEMENTS, and REFERENCES_SOURCE.

Use MDGraph as the first stop for documentation work. Treat it as invited
documentation context, not hidden memory and not a source-code graph.

Default order for Markdown/documentation questions:

1. mdgraph_status if index availability or freshness is unclear.
2. mdgraph_context for task-start context when the task touches architecture,
	roadmap, public contracts, CLI/MCP behavior, release process, docs policy,
	ADRs, runbooks, incidents, source_refs, or any cross-document feature chain.
3. mdgraph_search for exact docs keyword/entity/path/command/config/API/error
	lookups before raw grep or manual file reads.
4. mdgraph_node or mdgraph_trace after search/context narrows the target.
5. Raw file reads or text search only when MDGraph is inactive, stale for the
	task, too sparse, exact neighboring prose is required, or the user explicitly
	asks for file-level inspection.

- If index availability is unclear -> mdgraph_status.
- Cross-document design, ADR, spec, runbook, incident, API, source-ref, or feature-chain questions -> mdgraph_context.
- Quick keyword, entity, path, command, config key, API route, or error-code lookup -> mdgraph_search.
- Known entity, document title, source path, graph id, or section path#anchor -> mdgraph_node.
- Relationship questions such as "how is A related to B" -> mdgraph_trace.

For coding tasks, include the task text and any known file paths in the
mdgraph_context query so the result works as a task-start documentation brief.

Prefer returned context directly when it includes enough content, reasons,
provenance, source refs, and risk notes. Read files when MDGraph is unavailable, the result
is too sparse, exact neighboring prose is required, or the user explicitly asks
for file-level inspection.`;

export const SERVER_INSTRUCTIONS_UNINDEXED = `# MDGraph — inactive

No MDGraph index was found for this workspace. Use normal file tools for this
session unless the user asks to initialize or index MDGraph. Do not create or
update an index without an explicit user request.`;