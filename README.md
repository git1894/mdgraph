<div align="center">

# MDGraph

### Deterministic Markdown Document Graph for AI Coding Workflows

**Index your documentation into an explainable knowledge graph — then search, trace, and context-pack with zero cloud dependencies.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/git1894/MDGraph/actions/workflows/ci.yml/badge.svg)](https://github.com/git1894/MDGraph/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)
[![Release](https://img.shields.io/github/v/release/git1894/MDGraph?include_prereleases&label=release)](https://github.com/git1894/MDGraph/releases)

<br>
<a href="./README-ZH.md">简体中文</a> • <a href="./docs/EN/Architecture.md">Architecture</a> • <a href="./docs/EN/Agent_Integration.md">Agent Integration</a> • <a href="./docs/EN/Evaluation_Questions.md">Evaluation_Questions</a>
<br>
**MDGraph is the documentation intelligence layer for AI coding agents.**
It turns your Markdown docs — specs, ADRs, runbooks, API references, design docs — into a local SQLite graph that agents query directly instead of grep-searching a wall of `.md` files.

<br>

</div>

---

## Get Started

### 1. Clone and Build

```bash
git clone https://github.com/git1894/MDGraph.git
npm install
npm run build
```

### 2. Initialize a Project

```bash
cd your-project
node /path/to/mdgraph/dist/bin/mdgraph.js init --docs "docs/**/*.md"
```

Creates `.mdgraph/config.json` with your Markdown include/exclude globs.

### 3. Index Your Docs

```bash
node /path/to/mdgraph/dist/bin/mdgraph.js index
```

Builds the deterministic graph: documents, sections, entities, edges — all derived from structure, not LLM hallucinations.

### 4. Connect Your Agent

Start the MCP server alongside your agent:

```bash
# Start the MCP server
node /path/to/mdgraph/dist/bin/mdgraph.js serve --mcp --path .

# Or configure your agent's MCP settings to launch it automatically:
# { "mcpServers": { "mdgraph": { "type": "stdio", "command": "node", "args": ["/path/to/mdgraph/dist/bin/mdgraph.js", "serve", "--mcp", "--path", "/your/project"] } } }
```

Your agent can now use MDGraph's five tools to explore documentation without reading files.

### 5. Keep Fresh Automatically

```bash
node /path/to/mdgraph/dist/bin/mdgraph.js watch --semantic
```

Watch mode runs one index when it starts, then hash-based incremental sync tracks subsequent file changes. Stop and re-start the MCP server when you restart your agent.

---

## Why MDGraph?

When an AI agent needs to understand your project's architecture, it typically greps through Markdown files — consuming tool calls and tokens on every read, with no understanding of how documents relate to each other.

**MDGraph gives agents a pre-indexed document graph** — entities linked by semantic edges (DEFINES, DEPENDS_ON, LINKS_TO, IMPLEMENTS), with FTS5 full-text search and explainable graph traversal. Agents query the graph in one tool call instead of opening five files.

| Without MDGraph | With MDGraph |
|---|---|
| Agent greps for "timeout config" across 20 files | One `mdgraph_search` call returns ranked sections with matched entities |
| Agent reads every linked document to understand a design chain | One `mdgraph_trace` call shows the complete graph path with edge kinds and provenance |
| Agent opens files one by one to gather context for a question | One `mdgraph_context` call returns a packed context package with reasons for each inclusion |
| Agent has no way to verify doc health or stale references | One `mdgraph doctor` call surfaces dead links, missing definitions, and content risks |

**Every result is explainable** — the graph records why a section matched (FTS hit, entity match, semantic vector, graph traversal), what edge connected two documents, and with what confidence and provenance.

---

## Key Features

| | |
|---|---|
| **Deterministic Extraction** | No LLM calls, no cloud — everything derived from Markdown structure: headings, front matter, links, WikiLinks, code blocks. Reproducible and auditable. |
| **Explainable Search** | Every result carries a reason — FTS5 hit, exact entity match, semantic vector similarity, or graph neighbor expansion. |
| **Graph Trace** | Bounded BFS traversal between any two nodes returns the complete path with edge kind, provenance, and confidence at each step. |
| **Context Builder** | Packs the search and expansion results into a character-budgeted context package — ideal for agent prompts. |
| **Hash-Based Incremental Indexing** | Only re-index changed files. Content hashes detect modifications; removed files are cleaned up automatically. |
| **Watch Mode** | Chokidar-based file watcher with configurable debounce — indexes on startup, then re-indexes on every save. |
| **Optional Semantic Vectors** | Local deterministic hash embeddings (no external model). Enable with `--semantic`. |
| **Documentation Health (Doctor)** | Lints your doc graph: dead links, stale source refs, missing definitions, weak links, possible contradictions, content risks. |
| **MCP Server** | Five focused tools for AI agents — search, context, node, trace, status. |
| **100% Local** | SQLite database in `.mdgraph/`. No data leaves your machine. |

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Coding Agent                          │
│                                                                 │
│  "How does the auth timeout affect the login flow?"             │
│      → calls MDGraph tools directly — no file reads            │
│                              │                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MDGraph MCP Server                          │
│                                                                 │
│   mdgraph_search · mdgraph_context · mdgraph_node              │
│   mdgraph_trace · mdgraph_status                                │
│                              │                                  │
│                              ▼                                  │
│                     SQLite Document Graph                       │
│   documents · sections · entities · source_refs · edges        │
│   FTS5 full-text search · optional local vectors               │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline

```
Markdown files → Scanner → Parser → Entity Extractor → Graph Builder → SQLite
                      ↓                                                    ↓
                 Link Resolver                                    Query Engine
                      ↓                                                    ↓
              Incremental Sync                                   CLI · MCP Server
```

1. **Scan** — Finds Markdown files matching include/exclude globs. Root `.gitignore` filtering is enabled by default and can be disabled through configuration.

2. **Parse** — Extracts front matter (YAML), headings, Markdown links, WikiLinks, code blocks, inline code, and source references using `yaml` + `remark-parse`.

3. **Extract** — Identifies entities (symbols, API routes, error codes, config keys, file paths, commands, packages, concepts) and builds graph records with typed edges:
   - `CONTAINS` — document → section, section → entity
   - `DEFINES` — entity definition context
   - `REFERENCES` — cross-document links
   - `DEPENDS_ON` — front matter declared dependency
   - `LINKS_TO` — WikiLink and Markdown link targets
   - `IMPLEMENTS` — document implements a referenced spec/entity
   - `SUPERSEDES` / `DEPRECATED_BY` — versioning and decision aging

4. **Resolve** — Link resolution across documents: Markdown link targets → document/section anchors, WikiLinks → indexed entities.

5. **Index** — Hash-based incremental sync writes only changed documents; full re-index via `--full`. Optional local semantic vector generation.

6. **Serve** — CLI and MCP expose search, context, node, trace, status, and doctor operations.

---

## CLI Reference

```bash
# Initialize
node dist/bin/mdgraph.js init --docs "docs/**/*.md"    # Create .mdgraph/config.json

# Indexing
node dist/bin/mdgraph.js index                          # Hash-based incremental sync
node dist/bin/mdgraph.js index --full                   # Full rebuild
node dist/bin/mdgraph.js index --full --semantic        # Full rebuild with vectors

# Inspection
node dist/bin/mdgraph.js status                         # Graph counts and DB health
node dist/bin/mdgraph.js status --json                  # Machine-readable output
node dist/bin/mdgraph.js status --storage --json        # Counts plus storage diagnostics

# Query
node dist/bin/mdgraph.js search "authentication timeout"             # FTS5 + entity search
node dist/bin/mdgraph.js search "authentication timeout" --semantic   # Include vector search
node dist/bin/mdgraph.js search "AuthService" --limit 10             # Limit results
node dist/bin/mdgraph.js search "AuthService" --explain --json       # Query/ranking diagnostics
node dist/bin/mdgraph.js context "why does RedisTimeoutError affect login"   # Context package
node dist/bin/mdgraph.js context "why does RedisTimeoutError affect login" --debug --json # Packing diagnostics
node dist/bin/mdgraph.js node "AuthService"                          # Resolve by name/path/id
node dist/bin/mdgraph.js node "docs/auth-v2-design.md#session-refresh" # Resolve a section by path anchor
node dist/bin/mdgraph.js trace "AuthService" "RedisTimeoutError"     # Graph path between two nodes
node dist/bin/mdgraph.js trace "AuthService" "RedisTimeoutError" --depth 8  # Custom depth

# Retrieval evaluation
node dist/bin/mdgraph.js eval                              # Run built-in alpha retrieval evaluation
node dist/bin/mdgraph.js eval --json                       # Machine-readable metrics
node dist/bin/mdgraph.js eval --path /your/project --json  # Evaluate an explicit indexed project
node dist/bin/mdgraph.js eval --query-set ecc --path /path/to/ecc --json # ECC path-only expected records

# MCP Server
node dist/bin/mdgraph.js serve --mcp                       # Start stdio MCP server
node dist/bin/mdgraph.js serve --mcp --path /your/project  # With explicit project root

# Watch
node dist/bin/mdgraph.js watch                             # Index now, then auto-reindex on file changes
node dist/bin/mdgraph.js watch --semantic                   # ...with vectors
node dist/bin/mdgraph.js watch --debounce 500               # Custom debounce (ms)

# Health
node dist/bin/mdgraph.js doctor                            # Documentation health report
node dist/bin/mdgraph.js doctor --json                     # Machine-readable
node dist/bin/mdgraph.js doctor --strict                   # Non-zero exit when issues are found

# Help
node dist/bin/mdgraph.js help                              # All commands
node dist/bin/mdgraph.js help search                       # Command-specific help
```

All query commands support `--json` for structured output useful to agents and scripts. `mdgraph eval` reports lightweight retrieval metrics for search/context/trace quality; it is a deterministic smoke check, not a real agent A/B benchmark. The default `alpha` query set targets the built-in fixture corpus; `--query-set ecc` uses path-only expected records for an indexed ECC-style workspace without copying external content. Stable top-level fields are documented in [Output_Contracts.md](docs/EN/Output_Contracts.md).

---

## MCP Tools

When running as an MCP server, MDGraph exposes five focused tools:

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mdgraph_search` | Search documents, sections, and entities by keyword or entity name. | Quick lookup — before reading files. |
| `mdgraph_context` | Build an explainable context package for a cross-document question. Supports MCP `knownFiles` and `maxChars` hints for task-start briefs. | Understanding a feature, debugging a flow — needs docs from multiple files. |
| `mdgraph_node` | Show details for a document, entity, source ref, section, or chunk. Supports `docs/file.md#anchor` for sections. | You know the name/path/anchor and want the full record. |
| `mdgraph_trace` | Find an explainable graph path between two nodes. | "How is A related to B" — relationship discovery. |
| `mdgraph_status` | Report index availability, counts, database path, and lightweight last-indexed freshness metadata. | Verify the index is active before relying on it. |

In a workspace with no `.mdgraph/` index, the server announces itself inactive — agents fall back to normal file tools, and indexing stays your decision.

### Agent Usage Guidance

MDGraph's MCP server delivers the following guidance to your agent automatically:

- **Use `mdgraph_context` before reading many docs manually** — it returns a packed bundle of relevant sections with their reasons for inclusion.
- **Include task text and known file paths in `mdgraph_context`** when starting a coding task — MCP accepts `knownFiles` and `maxChars` for tighter briefs.
- **Use `mdgraph_search` for quick keyword or entity lookup** — results are ranked by relevance with matched entities highlighted.
- **Use `mdgraph_node` when you know what you're looking for** — resolves by name, path, `docs/file.md#anchor`, or graph ID.
- **Use `mdgraph_trace` for relationship questions** — returns every step of the path with edge kind, provenance, and confidence.
- **Use `mdgraph_status` as a lightweight readiness check** — it does not scan files for stale changes; run `mdgraph doctor --json` or `mdgraph index` after Markdown changes.
- **Prefer returned context directly** when it includes enough content and reasons. Only read files when MDGraph is unavailable or the returned context is clearly insufficient.

For host-specific setup notes and the shared instruction template, see [Agent_Integration.md](docs/EN/Agent_Integration.md).
Scoped file-read comparison case notes are recorded in [Agent_File_Read_Comparison.md](docs/EN/Agent_File_Read_Comparison.md).
Reusable instructions, MCP config, and prompt templates are packaged in [agent-pack/](agent-pack/).

---

## Configuration

Configuration lives in `.mdgraph/config.json`, created by `mdgraph init`.

```json
{
  "docs": {
    "include": ["docs/**/*.md", "**/*.md"],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.git/**",
      "**/.mdgraph/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.cache/**",
      "temp/**",
      "**/temp/**",
      "tmp/**",
      "**/tmp/**"
    ]
  },
  "index": {
    "parseMdx": false,
    "followGitignore": true,
    "maxFileBytes": 524288
  },
  "search": {
    "defaultLimit": 8,
    "maxDepth": 2,
    "maxContextChars": 28000,
    "highFrequencyEntityThreshold": 50
  },
  "entities": {
    "enabledKinds": ["symbol", "api_route", "error_code", "config_key", "file_path", "command", "package", "concept"],
    "stopEntities": ["Config", "Error", "Service", "API", "User", "Data"]
  },
  "embedding": {
    "enabled": false,
    "provider": "local-hash",
    "model": "mdgraph-local-hash-v1",
    "dimensions": 128
  }
}
```

### Configuration Fields

| Section | Field | Default | Description |
|---------|-------|---------|-------------|
| `docs.include` | | `["docs/**/*.md", "**/*.md"]` | Glob patterns for Markdown files to index |
| `docs.exclude` | | Common generated/dependency dirs such as `**/node_modules/**`, `**/dist/**`, `**/.git/**`, `**/.mdgraph/**`, `**/temp/**`, and `**/tmp/**` | Glob patterns to exclude |
| `index.parseMdx` | | `false` | Enable MDX parsing (future) |
| `index.followGitignore` | | `true` | Skip files matching the root `.gitignore` |
| `index.maxFileBytes` | | `524288` | Skip files larger than 512 KiB |
| `search.defaultLimit` | | `8` | Default max results for search |
| `search.maxDepth` | | `2` | Graph expansion depth for context builder |
| `search.maxContextChars` | | `28000` | Character budget for context packages |
| `search.highFrequencyEntityThreshold` | | `50` | Entities appearing in more docs than this are down-ranked |
| `entities.enabledKinds` | | `[default 8 kinds]` | Entity kinds to extract during indexing |
| `entities.stopEntities` | | `["Config", "Error", "Service", "API", "User", "Data"]` | Entity names to ignore |
| `embedding.enabled` | | `false` | Enable local semantic vectors |
| `embedding.provider` | | `"local-hash"` | Vector provider (only `local-hash` available) |
| `embedding.model` | | `"default"` | Model name (reserved for future) |
| `embedding.dimensions` | | `128` | Vector dimensions |

Semantic search is entirely optional. Without vectors, MDGraph still works through FTS5 and graph traversal.

---

## Storage Growth and Maintenance

The SQLite database grows with effective document text, section count, entity count, edge count, FTS rows, and optional vector rows. Expected growth should be roughly linear for ordinary authored Markdown. Growth can be amplified by accidentally indexing generated/dependency/temp directories, broad entity extraction, high-dimensional JSON vectors, or old SQLite pages left behind after deletes.

MDGraph uses an external-content FTS5 table so chunk text is not copied into FTS shadow content tables. Section and chunk content are still stored separately because sections preserve Markdown structure while chunks are the search/context unit.

Use `node dist/bin/mdgraph.js status --storage --json` to inspect page counts, freelist state, WAL checkpoint state, table/index/FTS shadow objects, path-group document contributions, edge-kind distribution, high-degree nodes, and vector providers. If the database grows unexpectedly, first check that `node_modules`, `dist`, archives, temp folders, and local index directories are excluded.

Maintenance behavior:

- `mdgraph index --full` performs a full rebuild, FTS optimize, WAL checkpoint, and `VACUUM`.
- Incremental indexing removes changed/deleted document records, optimizes FTS, and checkpoints WAL without vacuuming on every save.
- SQLite does not automatically shrink the database file after deletes; run `mdgraph index --full` when you need file compaction.

---

## Doctor — Documentation Health Analysis

`mdgraph doctor` is a rule-based documentation health check. It analyzes the graph and reports:

Before reporting graph health, doctor compares current Markdown files with the SQLite index. If files were added, deleted, modified, or changed document IDs, it returns a read-only stale-index diagnostic and asks you to run `mdgraph index` instead of mixing current files with old graph data.

| Issue | Description |
|-------|-------------|
| **Dead Links** | Markdown links and WikiLinks that point to non-existent documents or anchors |
| **Stale Source References** | `source_refs` entries where the referenced file no longer exists on disk |
| **Missing Definitions** | Design, ADR, API, runbook, and spec documents that have zero incoming definition edges |
| **Weakly Linked Docs** | Documents with fewer than 2 non-containment edges — potential orphans in the graph |
| **Orphan Docs** | Documents with zero non-containment edges — completely disconnected from the graph |
| **Possible Contradictions** | Entity definitions where the _same normalized name_ points to multiple distinct documents (reserved — `CONTRADICTS` edges are not yet emitted during indexing) |
| **Content Risks** | Flagged patterns: prompt-injection text, script/iframe HTML, active data URIs, and hidden Unicode format characters |
| **Stale Index** | Current Markdown files no longer match `.mdgraph/graph.db`; run `mdgraph index` before relying on doctor conclusions |

```bash
node dist/bin/mdgraph.js doctor

# Sample output:
# MDGraph health report
# Project: /your/project
# Documents: 42
# Orphan docs: 3
# Dead links: 2
# Stale source refs: 4
# Missing definitions: 1
# Weakly linked docs: 5
# Possible contradictions: 0
# Content risks: 1
# Stale index: 0
```

Doctor checks are designed to point maintainers at likely cleanup work — they are not a gate on indexing. Use `mdgraph doctor --strict` in CI or release checks when any reported issue should fail the command.

---

## Library Usage

MDGraph can be imported and used programmatically:

```typescript
import {
  scanMarkdownFiles,
  parseMarkdownDocument,
  buildGraphRecords,
  searchGraph,
  buildContext,
  traceNodes,
  indexProject,
  GraphRepository,
  openDatabase,
  loadConfig,
  runDoctor
} from "mdgraph";

// Load project config
const config = loadConfig("/path/to/project");

// Index documents
const result = await indexProject("/path/to/project", { full: true, semantic: false });
console.log(`Indexed ${result.files} files`);

// Open the repository and query
const repository = new GraphRepository(openDatabase("/path/to/project"));
try {
  const searchResults = searchGraph(repository, config, "authentication timeout");
  const context = buildContext(repository, config, "why does RedisTimeoutError affect login");
  const trace = traceNodes(repository, "AuthService", "RedisTimeoutError", 6);
} finally {
  repository.close();
}

// Doctor analysis
const report = await runDoctor("/path/to/project");
```

---

## Data Model

The SQLite database lives at `.mdgraph/graph.db` and stores the following record types:

| Table | Records |
|-------|---------|
| `documents` | One row per Markdown file — path, content hash, type (spec/design/adr/api/runbook/incident/meeting/guide/memory/other), trust tier (authored/generated/validated/external/untrusted), metadata |
| `sections` | Heading-bounded regions — anchor, level, line range, content |
| `entities` | Named symbols — kind (symbol/api_route/error_code/config_key/file_path/command/package/concept/decision), normalized name, optional namespace |
| `source_refs` | File paths referenced by documents — used by doctor to detect stale references |
| `edges` | Graph relationships — kind (CONTAINS/DEFINES/REFERENCES/DEPENDS_ON/LINKS_TO/IMPLEMENTS/REFERENCES_SOURCE/SUPERSEDES/DEPRECATED_BY), weight, confidence, provenance (frontmatter/markdown_link/wikilink/declared_section/heading/inline_code/code_block/regex), metadata |
| `chunks` | Text chunks with token estimates — used by search and context packing |
| `chunks_fts` | FTS5 full-text index for fast keyword search |
| `chunk_vectors` | Optional local semantic vectors (128-dim by default) |

### Edge Kinds

| Edge Kind | Source → Target | Provenance | Confidence |
|-----------|---------------|------------|------------|
| `CONTAINS` | Document → Section, Section → Entity | structure | high |
| `DEFINES` | Entity → Chunk | heading / frontmatter | high |
| `REFERENCES` | Document → Entity, Section → Entity | markdown_link / wikilink / inline_code | high |
| `DEPENDS_ON` | Document → Document | frontmatter `depends_on` | explicit |
| `LINKS_TO` | Document → Document, Section → Section | markdown_link / wikilink | high |
| `IMPLEMENTS` | Document → Entity | frontmatter `implements` | explicit |
| `REFERENCES_SOURCE` | Document → SourceRef | frontmatter `source_refs` | explicit |
| `SUPERSEDES` | Document → Document | frontmatter `supersedes` | explicit |
| `DEPRECATED_BY` | Document → Document | frontmatter `deprecated_by` | explicit |
| `SAME_AS` | (reserved) | — | — |
| `RELATED_TO` | (reserved) | — | — |
| `CONTRADICTS` | (reserved) | — | — |

---

## Architecture

| Area | Path | Responsibility |
|------|------|---------------|
| CLI | `src/bin/mdgraph.ts` | Commander-based CLI — init, index, status, search, context, node, trace, serve, watch, doctor |
| Config | `src/config/load-config.ts` | `.mdgraph/config.json` creation, defaults, safe merging |
| Scanner | `src/scanner/file-scanner.ts` | Glob-based Markdown file discovery with optional gitignore support |
| Parser | `src/parser/*` | Front matter (yaml), Markdown AST (remark-parse, GFM), headings, links, WikiLinks, code blocks |
| Extraction | `src/extraction/*` | Entity extraction from parsed documents; graph record assembly |
| Resolution | `src/resolution/link-resolver.ts` | Cross-document link target resolution |
| Storage | `src/db/*` | SQLite schema, connection, GraphRepository, record replacement, incremental updates |
| Query | `src/query/*` | FTS5 + entity search ranking, context packing with graph expansion, BFS graph tracing |
| Semantic | `src/semantic/local-embedding.ts` | Deterministic local hash vector generation and cosine similarity |
| MCP | `src/mcp/*` | JSON-RPC stdio MCP server, tool handlers, server instructions |
| Watch | `src/watcher/file-watcher.ts` | Chokidar-based file watcher with debounced incremental re-indexing |
| Analysis | `src/analysis/doctor.ts` | Rule-based doc health: dead links, stale refs, orphan detection, content risks |

Full details: [Architecture.md](docs/EN/Architecture.md)

---

## Requirements

- **Node.js `>=22.5.0`** — uses the built-in `node:sqlite` module
- **npm** — for installation and build

On current Node versions, `node:sqlite` may emit an experimental startup warning. This is normal — the warning does not indicate a failed run.

---

## Current Tradeoffs

- **Semantic vectors are deterministic, not learned** — the built-in `local-hash` provider is a lightweight embedding that supports cosine scoring, but does not match the quality of a dedicated embedding model. Semantic search is entirely optional.
- **Watch mode updates the database** — it indexes once on startup, then incrementally updates on changes. MCP tools open the current state on each call.
- **Doctor checks are rule-based** — they point maintainers at likely cleanup work and are not a gate on indexing.
- **Storage diagnostics are a report, not a repair tool** — use `status --storage` to inspect growth signals, then run `index --full` when compaction is needed.
- **`SAME_AS`, `RELATED_TO`, and `CONTRADICTS` are reserved edge kinds** — the deterministic MVP does not emit them during indexing. Contradiction-like signals are reported by doctor rather than inserted as graph edges.
- **Limited to standard Markdown** — MDX and other extended Markdown dialects are not yet fully supported.

---

## Troubleshooting

**"No MDGraph index found"** — Run `node dist/bin/mdgraph.js init` then `node dist/bin/mdgraph.js index` first.

**Indexing is slow** — Check that `node_modules`, `dist`, and other large directories are in the exclude list. Use `--debug` or check `doctor` output.

**Search returns no results** — The query may be too specific or the corpus may not contain matching terms. Try broader terms, check that the index was built (`mdgraph status`), and verify your include globs pick up the expected files.

**MCP server not connecting** — Make sure the project is initialized and indexed. Verify the `--path` argument points to the project root. Check that `node:sqlite` is available (Node 22.5+).

**Experimental warning on startup** — This is a Node.js warning for the `node:sqlite` module. It does not affect functionality. Suppress with `--no-warnings` if desired.

**Watch mode doesn't pick up changes** — Verify chokidar can access the file system. On some platforms, polling may be needed for network drives.

**Database file keeps growing** — Run `node dist/bin/mdgraph.js status --storage --json` to find large path groups, FTS shadow objects, vector rows, and freelist pages. Verify excludes first; use `node dist/bin/mdgraph.js index --full` to rebuild and compact.

---

## Evaluation Questions

MDGraph is designed to answer these categories of documentation questions for AI agents:

1. Why does a specific error code affect a specific user flow?
2. Which older decisions does a given design document depend on?
3. Where is a specific API route defined and where is it referenced?
4. Which runbooks or operational notes are affected by changing a specific config key?
5. Which documents have been superseded by newer designs?
6. Which design assumptions are related to a specific incident report?
7. Which documents correspond to a specific source path?
8. Which documents mention the same entity but do not link to each other?
9. Which design documents are missing source references?
10. What is the complete documentation chain for a specific feature, from requirement to implementation?

Full evaluation methodology: [Evaluation_Questions.md](docs/EN/Evaluation_Questions.md)

---

## Development

```bash
npm run typecheck         # TypeScript type checking
npm test                  # Run test suite (Vitest)
npm run clean             # Remove dist/
npm run build             # tsc + asset copy
npm run smoke:cli         # Build-output CLI smoke checks
npm run smoke:pack        # npm pack install-and-run smoke check
npm run test:watch        # Watch mode for tests
```

---

## License

MIT

---

<div align="center">

**Made for AI coding agents — reduce documentation discovery from multiple file reads to single graph queries.**

[Architecture](docs/EN/Architecture.md) · [Evaluation](docs/EN/Evaluation_Questions.md) · [Changelog](CHANGELOG.md)

</div>