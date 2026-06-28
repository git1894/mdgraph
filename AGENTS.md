# MDGraph Agent Guidelines

## Project Boundaries

- MDGraph is a local-first Markdown document graph tailored for AI coding workflows—not a general-purpose RAG system, cloud embedding service, Neo4j deployment, or full personal knowledge base.
- The current architecture is defined by [Architecture.md](./docs/EN/Architecture.md); actual behavior follows the public commands in `src/`, `__tests__/`, and the README.
- Keep the core pipeline clean: scanner -> parser -> extraction/resolution -> SQLite storage -> query -> CLI/MCP. Module responsibilities overview is in [Architecture.md](./docs/EN/Architecture.md).
- Deterministic parsing and interpretable graph relationships come first. Do not make LLMs, cloud services, or high-quality vector models prerequisites for the core indexing/querying.

## Development Commands

- Install dependencies: `npm install`
- Type check: `npm run typecheck`
- Tests: `npm test`
- Build: `npm run build`
- CLI smoke tests: Run `npm run build` first, then prioritize non-daemon commands: `node dist/bin/mdgraph.js index --json`, `status --json`, `search`, `context`, `node`, `trace`, `doctor`. For MCP or watcher changes, separately cover `serve --mcp` and `watch`.

Node.js requires `>=22.5.0`. This project uses `node:sqlite`; current Node versions may print an experimental warning—as long as the command exits successfully, this is not a failure signal.

## Documentation Graph Usage

- Use MDGraph before raw Markdown grep/read loops for architecture, roadmap, public contract, CLI/MCP behavior, release, docs policy, ADR, runbook, incident, source_ref, or cross-document feature-chain questions.
- If index availability or freshness is unclear, call `mdgraph_status` first.
- Use `mdgraph_context` as the task-start documentation brief before reading multiple docs manually; include task text and any known files.
- Use `mdgraph_search` for docs keyword/entity/path/command/config/API/error lookup before raw text search.
- Fall back to normal file reads or grep only when MDGraph is inactive, stale for the task, too sparse, exact neighboring prose is required, or the user explicitly asks for file-level inspection.

## Code Conventions

- Code is TypeScript ESM / NodeNext; when importing local TS modules, use the compiled `.js` extension form.
- Prioritize reusing existing module boundaries: `src/scanner`, `src/parser`, `src/extraction`, `src/resolution`, `src/db`, `src/query`, `src/mcp`, `src/watcher`, `src/analysis`.
- Data models and public types are concentrated in [src/types.ts](./src/types.ts); the SQLite schema lives in [src/db/schema.sql](./src/db/schema.sql). When changing types, edge kinds, table structures, or public outputs, update tests and related docs simultaneously.
- When parsing Markdown/front matter/link/entity, use structured parsing and existing helpers; avoid scattering regex and path/anchor normalization logic at call sites.
- Query-type CLI/MCP outputs should explain result provenance; `search`/`context`/`node`/`trace` should retain reason, matched entity, edge kind, provenance, confidence, path, or budget info at relevant locations.

## Testing & Verification

- For new features or fixes, prioritize adding focused tests located in `__tests__/**/*.test.ts`, run by Vitest.
- Focus coverage on deterministic indexing, front matter, Markdown/WikiLink, entity roles, source_refs / IMPLEMENTS, incremental updates, MCP tools, and context budgets.
- For regressions or public behavior changes, at minimum run `npm run typecheck` and relevant `npm test -- <file>`; for larger changes run `npm test` and `npm run build`.
- Evaluation questions oriented toward agent effectiveness are in [Evaluation_Questions.md](./docs/EN/Evaluation_Questions.md).
