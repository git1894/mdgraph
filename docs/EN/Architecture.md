# MDGraph Architecture

MDGraph uses this implemented pipeline: scanner -> parser -> extractor/resolver -> SQLite storage -> query engine -> CLI/MCP.

## Module Map

| Area | Path | Responsibility |
|---|---|---|
| CLI | `src/bin/mdgraph.ts` | Commands for init, index, status, search, context, node, trace, eval, diff, bundle, report, semantic status, serve, watch, and doctor; doctor supports `--strict`, `--fail-on`, `--changed`, and `--since`. |
| Config | `src/config/load-config.ts` | Default config, `.mdgraph/config.json` creation, and safe config merging. |
| Scanner | `src/scanner/file-scanner.ts` | Finds Markdown files using include/exclude globs and max file size limits. |
| Parser | `src/parser/*` | Front matter, Markdown AST, headings, code blocks, inline code, Markdown links, and WikiLinks. |
| Extraction | `src/extraction/*` | Converts parsed documents into graph records and deterministic entity/edge signals. |
| Resolution | `src/resolution/link-resolver.ts` | Resolves Markdown and WikiLink targets to indexed documents or sections. |
| Storage | `src/db/*` | SQLite connection, schema, record replacement, incremental updates, graph queries, and storage diagnostics. |
| Query | `src/query/*` | Search ranking, context packing, and graph trace. |
| Evaluation | `src/evaluation/*` | Retrieval evaluation cases, expected records, and lightweight metrics for search/context/trace quality. |
| Benchmark | `src/benchmark/*` | Structured with/without-MDGraph agent run record parsing and paired delta aggregation. |
| Bundle | `src/bundle/*` | Private directory graph bundle creation and verification using schema/source/config/document hashes. |
| Reporting | `src/reporting/*` | CI-friendly graph workflow reports that aggregate counts, storage, doctor, eval, bundle, diff, and benchmark summaries. |
| Diff | `src/diff/*` | Git base-ref documentation graph diff and PR impact summary generation. |
| Semantic | `src/semantic/*` | Deterministic local vector generation, Float32 vector codec, provider status, and cosine scoring. |
| MCP | `src/mcp/*` | Newline-delimited JSON-RPC MCP server and tool handlers. |
| Watch | `src/watcher/file-watcher.ts` | Debounced incremental reindexing via chokidar. |
| Analysis | `src/analysis/doctor.ts` | Documentation health and governance report. |

## Data Model

The SQLite database is stored at `.mdgraph/graph.db` and created from `src/db/schema.sql`.

Primary records:

- `documents`: one row per Markdown document, with path, hash, status, type, trust tier, and metadata.
- `schema_metadata`: key/value metadata for current schema version, MDGraph version provenance, update time, and `current`/`legacy` baseline.
- `schema_migrations`: reserved audit table for future real schema migrations.
- `sections`: heading-bounded document regions with anchors and source line ranges. A section's content stops before the next heading at any depth; parent/child context is recovered through graph relationships rather than duplicated chunk text.
- `entities`: symbols, API routes, error codes, config keys, file paths, commands, packages, and concepts.
- `source_refs`: source/config/script paths referenced by documents.
- `edges`: graph relationships with kind, confidence, weight, provenance, and metadata.
- `chunks`: text chunks derived from section content and used by search and context packing.
- `chunks_fts`: external-content FTS5 index for keyword search, keyed by `chunks.rowid` so the source chunk text is not stored a second time inside FTS shadow content tables. CJK text is augmented with lightweight n-gram tokens only in the FTS index content.
- `chunk_vectors`: optional local semantic vectors keyed by chunk and stored as Float32 BLOB rows.

## Indexing Flow

1. `scanMarkdownFiles` selects candidate Markdown files from config.
2. `parseMarkdownDocument` reads front matter and Markdown structure.
3. `buildGraphRecords` creates documents, sections, entities, source refs, chunks, vectors, and edges.
4. `GraphRepository.replaceAll` writes a full rebuild, or `replaceDocuments` updates changed/deleted documents.
5. `indexProject` compares stored hashes to parsed hashes and chooses full or incremental mode.

Incremental mode deletes document-derived records for changed and removed files, removes their FTS terms, reinserts changed records, and prunes unreferenced global entities/source refs after cleanup. Full rebuilds optimize and vacuum the SQLite database so old FTS pages and deleted rows do not keep inflating the on-disk file.

## Storage Diagnostics

`GraphRepository.storageDiagnostics` powers `mdgraph status --storage` and the storage portion of `mdgraph doctor`. It reports SQLite page counts, freelist state, journal/WAL checkpoint state, table/index/FTS shadow object sizes when `dbstat` is available, path-group content contribution, edge-kind distribution, high-degree nodes, vector storage format, and vector provider counts.

The full storage report is read-oriented observability. `doctor` promotes only a small actionable subset into storage health warnings; it does not create graph edges from storage facts. When storage growth is unexpected, users should first check include/exclude globs and generated/dependency/temp directories, then run `mdgraph index --full` when they need a rebuild plus `VACUUM` compaction.

## Schema Metadata And Workflow Artifacts

`openDatabase` applies the current schema and records schema metadata. Databases created by the current CLI are marked with a `current` baseline. Existing databases that predate metadata are marked `legacy` after the schema table is created. If a database already declares a future schema version, MDGraph refuses to open it before applying local schema SQL, which avoids silently downgrading a newer graph.

`createGraphBundle` writes a private directory bundle under `.mdgraph/bundles/private/`. The bundle contains the SQLite graph, config snapshot, manifest, and a storage/status report. The manifest records schema version, MDGraph version, graph counts, Git provenance when available, a canonical config hash, and a source hash built from sorted document path/hash records. It deliberately omits Markdown body content and the absolute project root.

`verifyGraphBundle` is read-only. It checks manifest shape, bundled database readability, schema version, counts, source/config/document hashes, report hashes, and freshness against the current workspace when a project root is available.

`generateReport` produces a CI-friendly JSON report from the current index. It aggregates schema metadata, counts, storage diagnostics, source hashes, doctor summaries, optional eval metrics, optional bundle verification, optional graph diff, optional paired benchmark summaries, and explicit previous-report state. It does not persist hidden report history.

## Graph Diff

`generateGraphDiff` supports the PR-oriented `diff --base <ref>` path. It resolves the base Git revision, copies tracked files into a temporary directory, writes the current MDGraph config there, indexes that temporary base project, and compares the resulting graph snapshot with the current graph index.

The diff report includes Markdown document additions, modifications, deletions, renames detected by Git, section/source-ref/edge count deltas, doctor warning-code deltas, changed source refs, affected document paths, and short PR summary lines. The base index is isolated in the OS temp directory and removed after the report. Diff does not inspect source-code ASTs, does not infer runtime code impact, and does not replace the current `.mdgraph/graph.db`.

## Query Flow

`searchGraph` combines and deduplicates:

- FTS5 chunk hits, including lightweight CJK n-gram matches for continuous Chinese/Japanese/Korean text.
- Exact entity matches.
- Optional local semantic vector matches.
- Graph neighbors around matching entities.

When the same document or section is reached by multiple paths, search applies reciprocal rank fusion (RRF) across definition, FTS, and optional semantic channels, then keeps the highest base score while merging the main reasons and matched entities so provenance is not lost. Each fused result keeps an explainable `RRF fusion (...)` reason.

`buildContext` then starts from ranked search sections, performs bounded graph expansion through non-containment edges, orders candidates to preserve cross-document diversity before repeating sections from one document, packages selected sections under a character budget, and includes reasons such as FTS hit, semantic hit, exact entity match, or the graph edge traversal path.

When requested through `context --debug`, context building also reports seed nodes, visited nodes, expanded edges, skipped expansion reasons, candidate counts, MMR-style document-diverse packing diagnostics, and budget truncation counts. These diagnostics are not graph facts; they exist to explain context packing and evaluate retrieval quality.

`traceNodes` performs bounded graph traversal between resolved nodes and returns each step with edge kind, provenance, and confidence.

`evaluateRetrieval` runs the built-in alpha, ECC path-only, or CJK evaluation cases against an indexed project. It reuses `searchGraph`, `buildContext`, and `traceNodes`, then reports expected-document recall, expected-section recall, context precision, trace success, latency, returned character budget, context diversity, reason coverage, RRF channels, query mode, and optional semantic reranker status. The evaluation output is a measurement aid, not a learned ranking model and not a replacement for focused regression tests.

`generateBenchmarkReport` consumes structured `AgentRunRecord` JSON only. It pairs one `with_mdgraph` and one `without_mdgraph` record by `questionId`, reports incomplete or duplicate pairs as skipped, and calculates deltas for file reads, searches, tool calls, MDGraph calls, character/token budgets, latency, raw-file fallback, and citation correctness. It does not parse transcripts, invoke models, or host agent runs.

## MCP Boundary

The MCP server intentionally exposes only five tools. Tool output is text-first and JSON-compatible so agents can use it without needing to inspect the SQLite database or read raw files first.

## Current Tradeoffs

- The semantic provider is deterministic and local, but it is a lightweight hash embedding rather than a high-quality language model embedding. Unsupported configured providers degrade to FTS5 and graph search; `semantic status` reports provider support, vector coverage, storage format, and reindex guidance.
- Watch mode updates SQLite on file changes; long-running MCP freshness is achieved by tools opening current database state on each call.
- Doctor checks are rule-based warnings. They first compare current files with indexed document hashes and IDs; stale indexes produce a read-only freshness diagnostic instead of mixed-time health conclusions.
- `doctor --changed` and `doctor --since <ref>` are Git-scoped views over the same health model; they report scope metadata, scoped graph issues, directly related one-hop graph documents, deleted-document warnings, and freshness diagnostics.
- Storage diagnostics are exposed through `status --storage` and reused by doctor for storage health summaries; they are not graph facts and do not expand the MCP tool surface.
- Private bundle artifacts are local workflow artifacts, not public exports. Public-safe sanitization and zip packaging are outside the current implementation.
- Benchmark reports are aggregate-only measurements from explicit structured records; full transcripts, hosted analytics, and agent runtime capture stay outside MDGraph.
- `SAME_AS`, `RELATED_TO`, and `CONTRADICTS` are reserved edge kinds in the public model. The deterministic MVP does not emit them during indexing; contradiction-like signals are currently reported by `doctor` rather than inserted as graph edges.
- The current implementation favors a compact MVP over broad Markdown/MDX dialect support.
