export const SERVER_INSTRUCTIONS = `# MDGraph — Markdown document graph for coding agents

MDGraph indexes project Markdown into a local SQLite graph: documents, sections,
entities, source references, and semantic edges such as DEFINES, DEPENDS_ON,
LINKS_TO, IMPLEMENTS, and REFERENCES_SOURCE.

Use MDGraph before reading many docs manually:

- Cross-document design, ADR, spec, runbook, incident, or API questions -> mdgraph_context.
- Known entity, document title, source path, or section path#anchor -> mdgraph_node.
- Relationship questions such as "how is A related to B" -> mdgraph_trace.
- Quick keyword/entity lookup -> mdgraph_search.
- Index health and counts -> mdgraph_status.

Prefer returned context directly when it includes enough content and reasons.
Only read files when MDGraph is unavailable or the returned context is clearly
insufficient.`;

export const SERVER_INSTRUCTIONS_UNINDEXED = `# MDGraph — inactive

No MDGraph index was found for this workspace. Use normal file tools for this
session unless the user asks to initialize or index MDGraph.`;