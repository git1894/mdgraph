# MDGraph Output Contracts

This document records the stable top-level JSON shapes for the 0.1 CLI surface. Nested record fields follow the public TypeScript model in `src/types.ts` unless noted otherwise.

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
- `storage.vectors`: total vector count and provider/model/dimension breakdown.

## `search --json`

`mdgraph search <query> --json` returns an array of search results. Each result has:

- `document`: graph document record.
- `section`: optional graph section record.
- `score`: numeric ranking score.
- `reason`: explanation for why the result matched.
- `content`: selected chunk or section content.
- `matchedEntities`: graph entity records that contributed to the match.

`mdgraph search <query> --explain --json` returns:

- `query`, `limit`, `entityCandidates`, `ftsQuery`, and `semanticEnabled`.
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

- `querySet`: `alpha` by default, or `ecc` when `--query-set ecc` is provided.
- `limit`: search result limit used per case.
- `generatedAt`: ISO timestamp for the evaluation run.
- `summary`: `cases`, `passed`, `failed`, `averageTopKDocumentRecall`, `averageExpectedSectionRecall`, `averageContextPrecision`, `averageLatencyMs`, and `averageReturnedChars`.
- `cases`: per-case results with `id`, `query`, `passed`, `expected`, `observed`, and `metrics`.

Per-case `expected` includes expected documents, sections, entities, edge kinds, and source refs. Per-case `observed` includes ranked search document paths, context item paths/headings/reasons, matched entities, resolved entities, resolved source refs, observed edge kinds, and optional trace results. Per-case `metrics` includes top-K document recall, expected-section recall, context precision, entity recall, source-ref recall, edge-kind coverage, trace success, latency, returned characters, budget fit, fanout, and reason coverage.

`mdgraph eval --path <project> --json` evaluates an explicit local project path. It does not add MCP tools and does not index automatically; run `mdgraph index` first for the target project. `mdgraph eval --query-set ecc --path <project> --json` uses ECC-style path-only expected records so an external workflow corpus can be scored without copying its document content into MDGraph fixtures.

## `doctor --json`

`mdgraph doctor --json` returns:

- `projectRoot`.
- `summary`: `documents`, `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, `contentRisks`, and `staleIndex`.
- `staleIndex`: `stale`, `recommendation`, and `issues`.
- Issue arrays: `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, and `contentRisks`.

`mdgraph doctor --strict` keeps the same output shape. It exits with a non-zero status when any summary issue count other than `documents` is greater than zero.