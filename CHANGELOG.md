# Changelog

All notable changes to MDGraph will be documented in this file.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning for public releases once the API surface is stable.

## Unreleased

## 0.5.0 - 2026-06-26

### Added

- Added a `cjk` retrieval evaluation query set with Chinese/Japanese fixture coverage plus lightweight CJK n-gram FTS preprocessing.
- Added explainable RRF search fusion, MMR-style context-packing diagnostics, `eval --query-mode`, and ranking/reranking evaluation metadata.
- Added `mdgraph semantic status` for provider support, vector coverage, storage format, and reindex guidance.
- Migrated semantic vectors from JSON arrays to compact Float32 BLOB storage and exposed semantic result provider/model/confidence metadata.

## 0.4.0 - 2026-06-25

### Added

- Added typed `doctor --json` warnings with stable codes, severity, evidence, affected nodes, and remediation hints while preserving existing summary and issue arrays.
- Added front matter diagnostics for invalid YAML, non-mapping front matter, unclosed front matter blocks, and invalid known MDGraph field shapes without blocking indexing.
- Added lifecycle doctor warnings for active documents that still link to deprecated or superseded documents.
- Added graph and storage health summaries to `doctor --json`, plus scoped `--changed` / `--since` reports and a typed `--fail-on` gate that does not change `--strict` semantics.
- Added one-hop related document coverage for scoped doctor reports, explicit `document.deleted` scoped warnings, and conservative `tag.invalid_format` / `link.non_posix_path` convention warnings.

### Fixed

- Fixed relative Windows-style Markdown URLs so they resolve consistently before doctor applies portable-link convention warnings.

## 0.3.1 - 2026-06-24

### Added

- Added deterministic MCP agent auto-mode metadata for search/context limit, depth, and character-budget decisions.
- Added structured context `sourceRefs` and `riskNotes` so task-start briefs expose source-reference links and non-active/generated document cautions.

### Changed

- Made MCP `mdgraph_status` perform a lightweight Markdown freshness check with `fresh`, `stale`, or `unknown` state before agents rely on an index.
- Broadened deterministic `suggestedNextQueries` so context results can suggest follow-up node/search calls even when `knownFiles` is absent.

## 0.3.0 - 2026-06-24

### Added

- Added initial 0.3 agent integration guidance with a shared instruction template, host setup notes, and query-first/file-read-second workflows.
- Added MCP `mdgraph_context` support for `knownFiles`, `maxChars`, and deterministic `suggestedNextQueries` in structured context results.
- Added a packaged `agent-pack/` with reusable instructions, host examples, MCP configuration, and prompt templates for MCP-capable coding agents.
- Added scoped agent file-read comparison case notes for alpha and ECC documentation workflows.

### Changed

- Refined MCP server instructions and tool descriptions so agents get clearer guidance without expanding the five-tool MCP surface.
- Added lightweight MCP `mdgraph_status` freshness metadata with last-indexed timing and a doctor/index recommendation.

## 0.2.0 - 2026-06-23

### Added

- Added `mdgraph eval` for the built-in alpha retrieval evaluation set, reporting per-case expected records and lightweight search/context/trace metrics.
- Added `mdgraph eval --query-set ecc` with path-only expected records for ECC-style external workflow corpora.
- Added `mdgraph search --explain` and `mdgraph context --debug` for explicit retrieval diagnostics without changing default outputs.
- Added `npm run smoke:eval` to validate the built CLI evaluation path against a temporary alpha-style corpus.
- Added diversity-aware context packing coverage to reduce repeated sections from one document under tight budgets.

### Fixed

- Prevented natural-language FTS queries containing boolean words or underscore-separated terms from triggering SQLite FTS5 `detail=none` phrase-query errors.

## 0.1.0 - 2026-06-22

### Added

- Added Linux and Windows CI validation with build-output CLI smoke and packed artifact smoke checks.
- Added `mdgraph doctor --strict` for CI-style failure when any doctor issue is reported.
- Added `mdgraph status --storage` with SQLite page/freelist/WAL state, object sizes, path-group contributions, edge-kind distribution, high-degree nodes, and vector provider counts.
- Added a realistic alpha evaluation fixture corpus covering ADRs, design docs, runbooks, API docs, incidents, source refs, and superseded documents.
- Added watch + MCP freshness regression coverage so changed Markdown files are visible to later MCP tool calls.
- Added public CLI JSON output contract documentation.

### Fixed

- Corrected duplicate heading anchor resolution so `#anchor` targets the first matching section and generated suffixes such as `#anchor-2` remain stable.
- Prevented WikiLinks inside inline code spans from creating graph links, while keeping normal prose WikiLinks and fenced-code filtering intact.
- Made `doctor` detect stale indexes before reporting graph health, returning a read-only freshness diagnostic instead of mixing current files with old SQLite data.
- Aligned MCP initialize `rootUri` / `workspaceFolders` with the default project root used by later tool calls, with invalid roots reported as input errors.
- Added `docs/file.md#anchor` section lookup for CLI/MCP node queries and structured ambiguity output for heading-only section queries.
- Preserved merged search explanations and matched entities when a document or section is reached by multiple search paths.
- Fixed section chunk boundaries so parent section chunks stop before child headings, avoiding duplicated chunk/FTS/context content.
- Updated watch mode to receive file change events reliably with Chokidar v4 by watching the project root and letting the indexer apply configured Markdown include/exclude rules.
- Improved scanner and SQLite open failure messages with actionable next steps.

### Documentation

- Updated README, architecture docs, MCP guidance, and the core correctness contract for stale-index doctor behavior, section lookup, search explanation merging, and chunk boundaries.
- Documented storage growth, maintenance behavior, `doctor --strict`, `status --storage`, and evaluation expected records.

### Tests

- Added focused regression coverage for anchor resolution, WikiLink extraction boundaries, stale-index doctor behavior, MCP project roots, node lookup ambiguity, search deduplication, and chunk/context boundaries.

## 0.1.0-alpha - 2026-06-20

### Added

- Deterministic Markdown indexing from front matter, headings, Markdown links, WikiLinks, code blocks, inline code, source references, and high-confidence entity patterns.
- SQLite graph storage for documents, sections, entities, source refs, edges, chunks, FTS5 data, and optional local vectors.
- CLI workflows for `init`, `index`, `status`, `search`, `context`, `node`, `trace`, `serve`, `watch`, and `doctor`.
- Explainable `search`, `context`, `node`, and `trace` outputs with reasons, graph metadata, provenance, and confidence where applicable.
- MCP stdio server with `mdgraph_search`, `mdgraph_context`, `mdgraph_node`, `mdgraph_trace`, and `mdgraph_status`.
- Hash-based incremental indexing, deletion cleanup, and watch mode.
- Optional deterministic local semantic vectors using the built-in `local-hash` provider.
- Rule-based `doctor` reporting for dead links, stale source refs, missing definitions, weak links, possible contradictions, and content risks.

### Notes

- MDGraph intentionally remains a local-first Markdown documentation graph, not a generic RAG app, cloud embedding service, Neo4j deployment, full source-code graph, or personal knowledge management system.
- Node.js `>=22.5.0` is required because the project uses Node's built-in `node:sqlite` module. Current Node versions may print an experimental warning even when commands succeed.

## 2026-06-18

Initial MDGraph

