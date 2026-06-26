# MDGraph Output Contracts

This document records the stable top-level JSON shapes for the 0.2 CLI surface. Nested record fields follow the public TypeScript model in `src/types.ts` unless noted otherwise.

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
