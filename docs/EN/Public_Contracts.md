# MDGraph Public Contracts

This document records the public contract boundary introduced for the 0.8 contract-hardening line. It complements [Output_Contracts.md](Output_Contracts.md), [Architecture.md](Architecture.md), and [Release_Checklist.md](Release_Checklist.md).

## Stability Labels

- `stable`: users and agents may rely on this shape. Additive fields are allowed; removing or renaming documented fields is a breaking change after 1.0.
- `stable-additive`: existing fields and semantics are stable, and the surface may gain optional fields or metrics when old consumers remain valid.
- `experimental`: available before 1.0, but semantics may be adjusted with changelog notes and focused tests.
- `reserved`: named for future use, but not active until an emitter or workflow is documented and tested.
- `internal`: implementation detail. It may change without compatibility guarantees.

## Contract Ledger

| Surface | Status | Owner | Contract |
|---|---|---|---|
| CLI command names and documented flags | stable | `src/bin/mdgraph.ts` | `usage`, `init`, `index`, `status`, `search`, `context`, `node`, `trace`, `eval`, `semantic status`, `bundle create/verify`, `export`, `import graphjson --verify`, `diff`, `report`, `serve --mcp`, `watch`, and `doctor`. Project-related commands support additive `--path <project>` where applicable. `status --freshness` adds optional freshness diagnostics without changing the default `status --json` shape. |
| Top-level CLI JSON output shapes | stable | `docs/EN/Output_Contracts.md` | Required fields documented in Output Contracts are stable; command-specific nested graph records follow `src/types.ts` unless marked otherwise. |
| MCP tool names and input schemas | stable | `src/mcp/tools.ts` | Exactly five tools: `mdgraph_search`, `mdgraph_context`, `mdgraph_node`, `mdgraph_trace`, and `mdgraph_status`; schemas reject undeclared properties. |
| MCP text output wording | experimental | `src/mcp/tools.ts` | Text is human-facing guidance; `structuredContent` is the preferred machine contract. |
| Context recovery fields | stable-additive | `src/query/context-builder.ts` | Context items expose `nodeId`, `documentId`, optional `sectionId`, optional `anchor`, line ranges, source refs, risk notes, and graph-expansion `edgePath` so agents can recover nodes and provenance without guessing from prose. |
| `.mdgraph/config.json` fields | stable | `src/config/load-config.ts` | `docs`, `index`, `search`, `entities`, and `embedding` default fields are stable. Unknown fields are currently ignored by merge logic. |
| `.mdgraph` file governance | stable | `src/config/load-config.ts`, `src/bin/mdgraph.ts` | `mdgraph init` keeps `.mdgraph/config.json` trackable, protects local `.mdgraph` artifacts through the root `.gitignore` when no equivalent ignore rule exists, and builds the initial graph index by default. `.mdgraph/graph.db` and generated `.mdgraph` artifacts are local workflow state, not source files. Use `--no-index` for config-only initialization. |
| SQLite schema metadata | stable | `src/db/schema.sql`, `src/db/connection.ts` | `schema_metadata.schema_version` gates compatibility. Future schema versions fail before local schema is applied. |
| SQLite table internals | internal | `src/db/schema.sql` | Rowids, FTS shadow tables, vector blob representation internals, and private bundle database contents are not public API. |
| Public graph record types | stable | `src/types.ts` | `GraphDocument`, `GraphSection`, `GraphEntity`, `SourceRef`, `GraphEdge`, `GraphChunk`, `ChunkVector`, `SearchResult`, and `TraceStep`. |
| Edge kinds | stable/reserved | `src/types.ts` | Active edge kinds are stable. `SAME_AS`, `RELATED_TO`, and `CONTRADICTS` are reserved until emitters are documented and tested. |
| Doctor warning shape | stable | `src/analysis/doctor.ts` | Warnings include `code`, `severity`, `message`, `evidence`, `affectedNodes`, and `remediation`. Warning codes are versioned by changelog and tests. |
| GraphJSON export and verify | stable format v1 | `src/export/graphjson.ts` | `format: "mdgraph-graphjson"`, `formatVersion: 1`, structural profile, deterministic ordering, and `graphHash` verification. |
| Bundle manifest | experimental | `src/bundle/bundle.ts` | `formatVersion: 1` private workflow artifact. It is not a public sanitized exchange format. |
| Report, diff, and benchmark JSON | experimental | `src/reporting`, `src/diff`, `src/benchmark` | CI-facing workflow outputs; required top-level fields are documented, but detailed metrics may expand before 1.0. |
| Semantic vector provider behavior | experimental | `src/semantic/*` | Optional local provider behavior must degrade to FTS5/graph search when unavailable or unsupported. |

## Compatibility Policy

- Additive JSON fields are allowed when existing documented fields keep their meaning.
- Removing, renaming, or changing the type of a documented stable field is breaking after 1.0.
- Optional CLI flags may be added when default behavior is unchanged.
- MCP tool names and required inputs are stable; optional inputs may be added when old clients continue to work.
- Unknown future GraphJSON fields may be ignored when required v1 fields are valid.
- Unsupported future `formatVersion` values must fail with actionable upgrade guidance.
- Error payloads should include a stable `code` and remediation when the command already returns structured errors.
- Non-zero exit behavior is part of the contract for failed verification, invalid bundle verification, strict doctor gates, and invalid command usage.

## Schema And Config Strategy

- Existing databases with no metadata are treated as `legacy` after metadata tables are created.
- Databases with a future `schema_version` fail before local schema SQL is applied.
- Existing migration helpers may update storage internals when the resulting public graph records stay compatible.
- Schema changes that cannot be safely migrated must fail with rebuild or upgrade guidance.
- New config fields must have defaults and must not make existing config files invalid unless the change is explicitly documented as breaking.
- Config numeric and path-related limits are part of the safety contract, not optional tuning hints.

## Release Matrix

Before a 0.9 context/evidence hardening release:

- Run `npm run typecheck`, focused contract tests, `npm test`, `npm run build`, `npm run smoke:cli`, `npm run smoke:eval`, `npm run smoke:pack`, `npm run task:public-check`, and `git diff --check`.
- Run `npm pack --dry-run` when package metadata or included public docs change.
- Validate on Node.js `>=22.5.0`; the regular development baseline is the current Node 22.x line.
- Treat Linux and Windows full CI as the release-gate baseline, and keep macOS covered by CI smoke for build-output CLI and packed-artifact behavior before 1.0.
- Use release maintainer smoke, not CI, for platform-specific long-running surfaces: `serve --mcp`, `watch`, and external corpus smoke via `MDGRAPH_EXTERNAL_ECC_PATH` where applicable.
- External corpus smoke is required when scanner, parser, storage, query, MCP, or doctor behavior changes materially.

## 1.0 Readiness

MDGraph should move from 0.9 to 1.0 only after:

- The ledger above is complete for every public surface.
- Critical public shapes are protected by focused tests or smoke gates.
- Experimental and internal surfaces are explicitly labeled in docs.
- Known output-shape inconsistencies are either normalized or intentionally documented.
- The release checklist can catch accidental public contract drift.
