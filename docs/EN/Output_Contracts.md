# MDGraph Output Contracts

This document records the stable top-level JSON shapes for the current CLI surface. Nested record fields follow the public TypeScript model in `src/types.ts` unless noted otherwise.

## `index --json`

`mdgraph index --json` returns an object with:

- `files`, `changed`, `deleted`, `unchanged`: numeric indexing counters.
- `mode`: `full` or `incremental`.
- `counts`: graph counts with `documents`, `sections`, `entities`, `sourceRefs`, `edges`, `chunks`, and `vectors`.

## `status --json`

`mdgraph status --json` returns graph counts directly:

- `documents`, `sections`, `entities`, `sourceRefs`, `edges`, `chunks`, `vectors`.

If no index exists, it returns:

- `indexed: false`, `projectRoot`, `database`.

`mdgraph status --storage --json` returns:

- `counts`: the same graph counts as `status --json`.
- `storage.database`: `pageSize`, `pageCount`, `freelistCount`, `estimatedBytes`, `journalMode`, and `walCheckpoint`.
- `storage.objects`: `dbstatAvailable` plus table/index/FTS shadow object entries.
- `storage.pathGroups`: document and chunk content contribution grouped by top-level path.
- `storage.edgeKinds`: edge count and average score data by edge kind.
- `storage.highDegreeNodes`: highest non-containment graph degree nodes.
- `storage.vectors`: `total`, compact storage `format`, and provider/model/dimension breakdown.

## `search --json`

`mdgraph search <query> --json` returns an array of search results. Each result has:

- `document`: graph document record.
- `section`: optional graph section record.
- `score`: numeric ranking score.
- `reason`: explanation for why the result matched.
- `content`: selected chunk or section content.
- `matchedEntities`: graph entity records that contributed to the match.
- `semantic`: optional semantic match metadata with `source`, `provider`, `model`, and `confidence`.

`mdgraph search <query> --explain --json` returns:

- `query`, `limit`, `queryMode`, `entityCandidates`, `ftsQuery`, `semanticEnabled`, and `semanticActive`.
- `ranking`: `fusion`, `fusionK`, `channels`, and `optionalReranker`.
- `matchedEntities`: entity names, kinds, and document frequencies used by ranking diagnostics.
- `results`: the same search result records returned by `search --json`.

## `context --json`

`mdgraph context <query> --json` returns:

- `query`: original query text.
- `maxChars`: configured context budget.
- `usedChars`: packed character count.
- `items`: context items with `path`, `title`, optional `heading`, optional `lines`, `reason`, `matchedEntities`, and `content`.

`mdgraph context <query> --debug --json` keeps the same fields and adds `debug` with:

- `seedNodes`, `visitedNodes`, and `expandedEdges`.
- `skippedVisitedNodes`, `skippedByNodeLimit`, and `skippedByDepth`.
- `candidateCount`, `directCandidates`, and `expandedCandidates`.
- `packingStrategy`, `packedItems`, `packedUniqueDocuments`, and `packingDiversityRatio`.
- `budgetTruncatedItems` and `budgetSkippedItems`.

## `node --json`

`mdgraph node <query> --json` returns the resolved node record when found:

- `id`, `label`, `kind`, `data`.

When a section query is ambiguous, it returns:

- `error: "ambiguous_section"`, `query`, `candidates`.

When no node is found, it returns:

- `error: "not_found"`, `query`.

## `trace --json`

`mdgraph trace <from> <to> --json` returns:

- `from`, `to`, `found`, `steps`, optional `message`.
- Each step includes `fromId`, `fromLabel`, `edgeFromId`, `edgeToId`, `edgeKind`, `toId`, `toLabel`, `traversalDirection`, `confidence`, and `provenance`.

## `eval --json`

`mdgraph eval --json` runs the built-in alpha retrieval evaluation cases against an indexed project and returns:

- `querySet`: `alpha` by default, `ecc` when `--query-set ecc` is provided, or `cjk` when `--query-set cjk` is provided.
- `limit`: search result limit used per case.
- `ranking`: query mode, RRF search fusion, context packing strategy, optional reranker status, semantic-active case count, search channels, ranking reason coverage, and average context diversity.
- `generatedAt`: ISO timestamp for the evaluation run.
- `summary`: `cases`, `passed`, `failed`, `averageTopKDocumentRecall`, `averageExpectedSectionRecall`, `averageContextPrecision`, `averageContextDiversity`, `averageLatencyMs`, and `averageReturnedChars`.
- `cases`: per-case results with `id`, `query`, `passed`, `expected`, `observed`, and `metrics`.

Per-case `expected` includes expected documents, sections, entities, edge kinds, and source refs. Per-case `observed` includes ranked search document paths, context item paths/headings/reasons, matched entities, resolved entities, resolved source refs, observed edge kinds, optional trace results, and ranking diagnostics. Per-case `metrics` includes top-K document recall, expected-section recall, context precision, entity recall, source-ref recall, edge-kind coverage, trace success, latency, returned characters, budget fit, fanout, reason coverage, ranking reason coverage, and context diversity.

`mdgraph eval --path <project> --json` evaluates an explicit local project path. It does not add MCP tools and does not index automatically; run `mdgraph index` first for the target project. `mdgraph eval --query-set ecc --path <project> --json` uses ECC-style path-only expected records so an external workflow corpus can be scored without copying its document content into MDGraph fixtures. `mdgraph eval --query-set cjk --path <project> --json` uses Chinese/Japanese expected records to measure CJK retrieval quality with the lightweight CJK n-gram preprocessing baseline. `mdgraph eval --query-mode semantic --json` requests optional semantic search and reports whether the local semantic reranker was active.

## `export graphjson --json`

`mdgraph export graphjson --json` returns a deterministic structural interoperability export:

- `format: "mdgraph-graphjson"` and `formatVersion: 1`.
- `schemaVersion`, `mdgraphVersion`, `exportProfile: "structural"`, `graphHash`, and `sourceHash`.
- `counts`: the full repository counts returned by `status --json`.
- `exportedCounts`: exported document, section, entity, source-ref, node, and edge counts.
- `nodes`: document, section, entity, and source-ref nodes.
- `edges`: structural edges whose endpoints are included in `nodes`.

The structural profile excludes chunks, chunk content, section content, vectors, SQLite rowids, SQLite database paths, and the absolute project root. `counts.edges` can be larger than `exportedCounts.edges` because chunk endpoint edges are omitted.

## `import graphjson --verify --json`

`mdgraph import graphjson graph.json --verify --json` verifies a GraphJSON file without writing `.mdgraph/graph.db` and returns:

- `valid`: boolean result.
- `errors`: structured validation errors with `code`, `message`, optional `evidence`, and `remediation`.
- `warnings`: non-fatal compatibility notes.
- `format`, `formatVersion`, `schemaVersion`, `graphHash`, `counts`, and `exportedCounts` when readable.

The command exits non-zero when `valid` is `false`. GraphJSON merge import is not supported in 0.7.

## `export mermaid trace --json`

`mdgraph export mermaid trace <from> <to> --json` returns:

- `format: "mdgraph-mermaid"` and `formatVersion: 1`.
- `diagramType: "trace"`.
- `found`: whether the graph trace was found.
- `diagram`: Mermaid flowchart text.
- `trace`: the same trace result shape returned by `trace --json`.

Without `--json`, the command prints only Mermaid text. The diagram renders existing graph trace facts; it does not generate an LLM summary.

## `export docs-site --json`

`mdgraph export docs-site --json` returns:

- `format: "mdgraph-docsite-index"` and `formatVersion: 1`.
- `sourceFormat: "mdgraph-graphjson"` and `graphHash`.
- `documents`: per-document path, title, status, document type, trust tier, defined entities, source refs, outbound links, and inbound links.

`mdgraph export markdown-index` prints an Obsidian-friendly Markdown view over the same graph facts.

## `export source-bridge --json`

`mdgraph export source-bridge --provider codegraph --artifact codegraph.json --json` returns a read-only source bridge report:

- `format: "mdgraph-source-bridge"` and `formatVersion: 1`.
- `provider: "codegraph"`.
- `status`: `ready` or `unsupported`.
- `reason`: unsupported/skipped reason when available.
- `sourceRefs`, `matched`, and `unmatched`.

The bridge reads only an explicit local CodeGraph-style JSON artifact. It does not create graph edges and does not affect indexing, search, context, or MCP tools.

## `bundle create --json`

`mdgraph bundle create --profile private --json` creates a private directory artifact under `.mdgraph/bundles/private/` and returns:

- `bundleDir`: absolute path to the created bundle directory.
- `manifestPath`: absolute path to `manifest.json`.
- `manifest`: bundle manifest with `format`, `formatVersion`, `schemaVersion`, `mdgraphVersion`, `createdAt`, `visibility`, `sourceHash`, `configHash`, `provenance`, `counts`, `documents`, and optional `reports`.

The private bundle contains `manifest.json`, `graph.db`, `config.json`, and a `reports/status-storage.json` snapshot. `sourceHash` is derived from canonical config plus sorted document path/hash records; it does not include Markdown body content or the absolute project root. Public or sanitized bundle profiles are not supported in 0.6.

## `bundle verify --json`

`mdgraph bundle verify <dir> --json` returns:

- `bundleDir`: absolute path to the checked bundle directory.
- `valid`: boolean result.
- `errors`: validation failures.
- `manifest`: parsed manifest when readable.
- `counts`: graph counts read from bundled `graph.db` when available.
- `schemaVersion`, `sourceHash`, and `configHash`: recomputed bundled values when available.
- `freshness`: `state` (`fresh`, `stale`, or `unknown`) plus `reason`, comparing the bundle source hash to the current workspace when possible.

The command exits non-zero when `valid` is `false`.

## `report --json`

`mdgraph report --json` returns a CI-friendly graph workflow report:

- `projectRoot`, `generatedAt`, `mdgraphVersion`, and `indexed`.
- `schema`: schema metadata with `schemaVersion`, `createdByVersion`, `updatedAt`, and `baseline` when indexed.
- `counts`, `storage`, and `source`: graph counts, storage diagnostics, and source/config/document hashes when indexed.
- `doctor`: doctor summary, warning counts, and top warning codes when indexed.
- `eval`: evaluation query set, summary, and ranking metadata when `--eval` is supplied.
- `bundle`: bundle verification result when `--bundle <dir>` is supplied.
- `diff`: graph diff result when `--base <ref>` is supplied.
- `benchmark`: paired benchmark result when `--benchmark <file>` is supplied.
- `trend`: `first_run`, `previous_report_loaded`, or `previous_report_missing`. Trend state only reflects an explicit `--previous-report <file>` input; MDGraph does not write hidden report history.

## `report --benchmark <file> --json`

`mdgraph report --benchmark benchmark-runs.json --json` reads structured agent run records and embeds a `benchmark` object in the report. The input must be either a JSON array of run records or an object with a `runs` array. MDGraph does not parse full transcripts, call models, or run an agent.

Each `AgentRunRecord` includes `id`, `questionId`, `question`, `mode` (`with_mdgraph` or `without_mdgraph`), timestamps, `toolCalls`, `directFileReads`, `textSearches`, `mdgraphCalls`, `finalCitations`, `rawFileFallback`, optional `tokenEstimate`, optional `characterBudget`, and `latencyMs`.

The embedded `benchmark` object returns:

- `format: "mdgraph-benchmark"` and `formatVersion: 1`.
- `records`: number of parsed run records.
- `summary`: question count, complete pair count, skipped pair count, and aggregate deltas. Deltas are `with_mdgraph - without_mdgraph`.
- `pairs`: one entry per complete pair, each with `withMdgraph`, `withoutMdgraph`, and `delta` metrics for file reads, text searches, tool calls, MDGraph calls, character/token budgets, latency, raw-file fallback, and citation correctness.
- `skipped`: incomplete, duplicate, or question-text-mismatched pairs. Exactly one `with_mdgraph` and one `without_mdgraph` record are required for a complete pair.

Citation correctness is automatic when `questionId` matches a built-in evaluation case: cited paths are compared with expected document/section paths. For non-evaluation questions, citations use explicit `correct: true`, `correct: false`, or `correct: "unknown"` markers from the run record. `unknown` citations are counted separately and excluded from correctness percentages.

## `diff --json`

`mdgraph diff --base <ref> --json` compares the current indexed graph to an isolated temporary index built from a Git base revision and returns:

- `mode`: currently `base_ref`.
- `base`: requested `ref`, resolved Git `revision`, and base `sourceHash`.
- `head`: current graph `sourceHash`.
- `summary`: `documentsAdded`, `documentsModified`, `documentsDeleted`, `documentsRenamed`, `sectionsChanged`, `sourceRefsChanged`, `edgesChanged`, and `warningDelta`.
- `documents`: changed Markdown document entries with `path`, optional `previousPath`, `change`, `hashChanged`, optional `statusChanged`, `sectionDelta`, `sourceRefDelta`, and optional `warningCodes`.
- `impact`: `changedSourceRefs`, `affectedDocs`, and concise `prSummary` lines.

Diff only compares Markdown graph records, source refs, and doctor warning codes. It does not parse source ASTs or infer runtime code impact. The base index is created in a temporary directory and does not replace the current `.mdgraph/graph.db`.

## `semantic status --json`

`mdgraph semantic status --json` returns:

- `projectRoot`.
- `state`: `disabled`, `not_indexed`, `ready`, `unsupported_provider`, or `needs_reindex`.
- `enabled`, `provider`, `model`, `dimensions`, and `providerSupported` for the configured embedding provider.
- `indexed`, `chunks`, `vectors`, `vectorStorageFormat`, and `indexedProviders`.
- `guidance`: actionable next steps such as running `mdgraph index --semantic`, re-embedding after provider changes, or falling back to FTS5 and graph search for unsupported providers.

## `doctor --json`

`mdgraph doctor --json` returns:

- `projectRoot`.
- `scope`: `mode`, `baseRef`, `changedPaths`, `deletedPaths`, `renamedPaths`, `untrackedPaths`, and `globalHealthIncluded`.
- `summary`: `documents`, `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, `contentRisks`, and `staleIndex`.
- `staleIndex`: `stale`, `recommendation`, and `issues`.
- Issue arrays: `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, `contentRisks`, and `frontmatterDiagnostics`.
- `warnings`: typed, action-oriented doctor warnings. Each warning includes `code`, `severity`, `message`, `evidence`, `affectedNodes`, and `remediation`.
- `health`: `graph` and `storage` summaries. Graph health includes `mostConnectedDocs`, `weaklyLinkedDocs`, `duplicateDefinitions`, `missingDefinitions`, and `missingDecisionLinks`. Storage health includes database size, path groups, FTS shadow sizing, high-degree nodes, vector counts, and storage warnings.

Initial warning codes cover the existing doctor checks, front matter diagnostics, lifecycle governance, graph health, storage health, and conservative convention linting: `index.stale`, `link.dead`, `source_ref.missing`, `definition.missing`, `definition.duplicate`, `content.risk`, `document.orphan`, `document.deleted`, `document.weakly_linked`, `document.deprecated_referenced`, `document.superseded_referenced`, `graph.missing_decision_link`, `storage.generated_path_indexed`, `storage.database_oversized`, `storage.fts_shadow_large`, `storage.high_degree_node`, `storage.vector_anomaly`, `front_matter.invalid_yaml`, `front_matter.not_mapping`, `front_matter.unclosed`, `front_matter.invalid_field`, `tag.invalid_format`, and `link.non_posix_path`.

`mdgraph doctor --strict` keeps the same output shape and exits with a non-zero status when any summary issue count other than `documents` is greater than zero. `mdgraph doctor --fail-on <severity>` adds a typed warning gate without changing `--strict`, and `--changed` / `--since <ref>` return scoped reports with explicit scope metadata. Scoped reports include scoped Markdown paths plus directly related one-hop graph documents; deleted Markdown paths are preserved in scope metadata and reported with `document.deleted` after the index is fresh. Global storage summaries may still be present for observability, but storage warnings are omitted when `globalHealthIncluded` is `false`.
