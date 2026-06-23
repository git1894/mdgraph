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

## `context --json`

`mdgraph context <query> --json` returns:

- `query`: original query text.
- `maxChars`: configured context budget.
- `usedChars`: packed character count.
- `items`: context items with `path`, `title`, optional `heading`, optional `lines`, `reason`, `matchedEntities`, and `content`.

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

## `doctor --json`

`mdgraph doctor --json` returns:

- `projectRoot`.
- `summary`: `documents`, `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, `contentRisks`, and `staleIndex`.
- `staleIndex`: `stale`, `recommendation`, and `issues`.
- Issue arrays: `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, and `contentRisks`.

`mdgraph doctor --strict` keeps the same output shape. It exits with a non-zero status when any summary issue count other than `documents` is greater than zero.