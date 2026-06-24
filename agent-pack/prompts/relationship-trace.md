# Relationship Trace Prompt

Use this when the user asks how two documents, entities, APIs, source refs, or decisions are related.

1. If either endpoint is fuzzy, call `mdgraph_search` for each endpoint first.
2. Call `mdgraph_trace` with the resolved endpoint names, paths, source refs, or graph ids.
3. If the trace path is not self-explanatory, call `mdgraph_context` with the relationship question and any known endpoint paths in `knownFiles`.
4. Explain the path using edge kinds, provenance, confidence, and cited document paths from the tool result.

Fall back to raw file reads only when MDGraph is unavailable or the returned trace/context is too sparse.