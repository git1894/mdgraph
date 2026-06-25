# Task-Start Documentation Brief

Use this when a coding task mentions docs, designs, ADRs, runbooks, APIs, source refs, or known files.

1. Call `mdgraph_status` if index availability is unclear.
2. Call `mdgraph_context` with:
   - `query`: the user's task text plus the main domain terms.
   - `knownFiles`: project-relative paths the user already named, when available.
   - `maxChars`: a smaller character budget when the host context is tight.
3. Use the returned context directly when it has enough content, reasons, provenance, source refs, and risk notes.
4. Read raw files only for exact sections that still need inspection.

Do not run `mdgraph index` unless the user asks to create or refresh the index.