export const SERVER_INSTRUCTIONS = `# MDGraph — Markdown document graph for coding agents

MDGraph indexes project Markdown into a local SQLite graph: documents, sections,
entities, source references, and semantic edges such as DEFINES, DEPENDS_ON,
LINKS_TO, IMPLEMENTS, and REFERENCES_SOURCE.

Use MDGraph before reading many Markdown files manually. Treat it as invited
documentation context, not hidden memory and not a source-code graph.

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