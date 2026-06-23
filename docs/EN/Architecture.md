# MDGraph Architecture

MDGraph uses this implemented pipeline: scanner -> parser -> extractor/resolver -> SQLite storage -> query engine -> CLI/MCP.

## Module Map

| Area | Path | Responsibility |
|---|---|---|
| CLI | `src/bin/mdgraph.ts` | Commands for init, index, status, search, context, node, trace, serve, watch, and doctor. |
| Config | `src/config/load-config.ts` | Default config, `.mdgraph/config.json` creation, and safe config merging. |
| Scanner | `src/scanner/file-scanner.ts` | Finds Markdown files using include/exclude globs and max file size limits. |
| Parser | `src/parser/*` | Front matter, Markdown AST, headings, code blocks, inline code, Markdown links, and WikiLinks. |
| Extraction | `src/extraction/*` | Converts parsed documents into graph records and deterministic entity/edge signals. |
| Resolution | `src/resolution/link-resolver.ts` | Resolves Markdown and WikiLink targets to indexed documents or sections. |
| Storage | `src/db/*` | SQLite connection, schema, record replacement, incremental updates, graph queries, and storage diagnostics. |
| Query | `src/query/*` | Search ranking, context packing, and graph trace. |
| Evaluation | `src/evaluation/*` | Retrieval evaluation cases, expected records, and lightweight metrics for search/context/trace quality. |
| Semantic | `src/semantic/local-embedding.ts` | Deterministic local vector generation and cosine scoring. |
| MCP | `src/mcp/*` | Newline-delimited JSON-RPC MCP server and tool handlers. |
| Watch | `src/watcher/file-watcher.ts` | Debounced incremental reindexing via chokidar. |
| Analysis | `src/analysis/doctor.ts` | Documentation health and governance report. |

## Data Model

The SQLite database is stored at `.mdgraph/graph.db` and created from `src/db/schema.sql`.

Primary records:

- `documents`: one row per Markdown document, with path, hash, status, type, trust tier, and metadata.
- `sections`: heading-bounded document regions with anchors and source line ranges. A section's content stops before the next heading at any depth; parent/child context is recovered through graph relationships rather than duplicated chunk text.
- `entities`: symbols, API routes, error codes, config keys, file paths, commands, packages, and concepts.
- `source_refs`: source/config/script paths referenced by documents.
- `edges`: graph relationships with kind, confidence, weight, provenance, and metadata.
- `chunks`: text chunks derived from section content and used by search and context packing.
- `chunks_fts`: external-content FTS5 index for keyword search, keyed by `chunks.rowid` so the source chunk text is not stored a second time inside FTS shadow content tables.
- `chunk_vectors`: optional local semantic vectors keyed by chunk.

## Indexing Flow

1. `scanMarkdownFiles` selects candidate Markdown files from config.
2. `parseMarkdownDocument` reads front matter and Markdown structure.
3. `buildGraphRecords` creates documents, sections, entities, source refs, chunks, vectors, and edges.
4. `GraphRepository.replaceAll` writes a full rebuild, or `replaceDocuments` updates changed/deleted documents.
5. `indexProject` compares stored hashes to parsed hashes and chooses full or incremental mode.

Incremental mode deletes document-derived records for changed and removed files, removes their FTS terms, reinserts changed records, and prunes unreferenced global entities/source refs after cleanup. Full rebuilds optimize and vacuum the SQLite database so old FTS pages and deleted rows do not keep inflating the on-disk file.

## Storage Diagnostics

`GraphRepository.storageDiagnostics` powers `mdgraph status --storage`. It reports SQLite page counts, freelist state, journal/WAL checkpoint state, table/index/FTS shadow object sizes when `dbstat` is available, path-group content contribution, edge-kind distribution, high-degree nodes, and vector provider counts.

The report is read-oriented observability. It does not change graph edges or doctor warnings. When storage growth is unexpected, users should first check include/exclude globs and generated/dependency/temp directories, then run `mdgraph index --full` when they need a rebuild plus `VACUUM` compaction.

## Query Flow

`searchGraph` combines and deduplicates:

- FTS5 chunk hits.
- Exact entity matches.
- Optional local semantic vector matches.
- Graph neighbors around matching entities.

When the same document or section is reached by multiple paths, search keeps the highest score while merging the main reasons and matched entities so provenance is not lost.

`buildContext` then starts from ranked search sections, performs bounded graph expansion through non-containment edges, orders candidates to preserve cross-document diversity before repeating sections from one document, packages selected sections under a character budget, and includes reasons such as FTS hit, semantic hit, exact entity match, or the graph edge traversal path.

When requested through `context --debug`, context building also reports seed nodes, visited nodes, expanded edges, skipped expansion reasons, candidate counts, and budget truncation counts. These diagnostics are not graph facts; they exist to explain context packing and evaluate retrieval quality.

`traceNodes` performs bounded graph traversal between resolved nodes and returns each step with edge kind, provenance, and confidence.

`evaluateRetrieval` runs the built-in alpha evaluation cases against an indexed project. It reuses `searchGraph`, `buildContext`, and `traceNodes`, then reports expected-document recall, expected-section recall, context precision, trace success, latency, returned character budget, and reason coverage. The evaluation output is a measurement aid, not a learned ranking model and not a replacement for focused regression tests.

## MCP Boundary

The MCP server intentionally exposes only five tools. Tool output is text-first and JSON-compatible so agents can use it without needing to inspect the SQLite database or read raw files first.

## Current Tradeoffs

- The semantic provider is deterministic and local, but it is a lightweight hash embedding rather than a high-quality language model embedding.
- Watch mode updates SQLite on file changes; long-running MCP freshness is achieved by tools opening current database state on each call.
- Doctor checks are rule-based warnings. They first compare current files with indexed document hashes and IDs; stale indexes produce a read-only freshness diagnostic instead of mixed-time health conclusions.
- Storage diagnostics are exposed through `status --storage`; they are not graph facts and do not expand the MCP tool surface.
- `SAME_AS`, `RELATED_TO`, and `CONTRADICTS` are reserved edge kinds in the public model. The deterministic MVP does not emit them during indexing; contradiction-like signals are currently reported by `doctor` rather than inserted as graph edges.
- The current implementation favors a compact MVP over broad Markdown/MDX dialect support.