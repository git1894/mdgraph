# MDGraph Release Checklist

Use this checklist before publishing an MDGraph release or asking a maintainer to cut one. It complements [CHANGELOG.md](../../CHANGELOG.md), [Output_Contracts.md](Output_Contracts.md), [Public_Contracts.md](Public_Contracts.md), [Alpha_Results.md](Alpha_Results.md), and the task public check described in [docs/tasks/README.md](../tasks/README.md).

## Public checks

- Confirm `package.json` version and CLI `program.version(...)` match.
- Confirm [CHANGELOG.md](../../CHANGELOG.md) has an entry for the release.
- Review README quick start, requirements, MCP setup, output contracts, public contract labels, and known tradeoffs when public CLI/MCP behavior changed.
- Refresh [Alpha_Results.md](Alpha_Results.md) when parser, scanner, storage, query, MCP, or doctor behavior changes materially on external corpora.

## 0.8 contract gate

- Confirm [Public_Contracts.md](Public_Contracts.md) labels every touched public surface as `stable`, `stable-additive`, `experimental`, `reserved`, or `internal`.
- Confirm focused contract tests cover MCP tool definitions, representative JSON fields, edge kinds, doctor warning shape, config defaults, and schema compatibility guidance.
- Confirm structured error outputs include a stable `code` and remediation where the command already returns structured errors.

## 0.9 evidence gate

- Confirm [Public_Contracts.md](Public_Contracts.md) labels context recovery fields as `stable-additive`.
- Confirm context, MCP, and contract tests cover `nodeId`, `documentId`, optional `sectionId`, optional `anchor`, and graph-expansion `edgePath`.
- Confirm `smoke:cli` exercises a multi-question structured benchmark and records external ECC skip/pass behavior.
- Confirm optional semantic behavior remains experimental unless a separate release explicitly freezes it.

## 1.0 readiness gate

- Confirm known output-shape inconsistencies are either normalized or intentionally documented.
- Confirm `context --json` and MCP `mdgraph_context.structuredContent` expose recovery fields (`nodeId`, `documentId`, optional `sectionId`, optional `anchor`, and graph-expansion `edgePath`) for agent handoff to `node`, `trace`, and raw Markdown.
- Confirm Node.js `>=22.5.0` remains the supported floor and the active release was tested on the current Node 22.x line.
- Confirm Windows has been smoke-tested locally or in CI. macOS and Linux should have CI or release maintainer smoke before 1.0.
- Confirm the 1.0 release notes call out compatibility promises separately from feature additions.

## Command gate

Run from the repository root after dependencies are installed:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:cli
npm run smoke:pack
node dist/bin/mdgraph.js index --json
node dist/bin/mdgraph.js doctor --strict --json
node dist/bin/mdgraph.js status --storage --json
node dist/bin/mdgraph.js bundle create --profile private --json
node dist/bin/mdgraph.js bundle verify BUNDLE_DIR_FROM_CREATE_OUTPUT --json
node dist/bin/mdgraph.js report --json --eval --bundle BUNDLE_DIR_FROM_CREATE_OUTPUT
node dist/bin/mdgraph.js diff --base HEAD --json
node dist/bin/mdgraph.js report --json --base HEAD
node dist/bin/mdgraph.js report --json --benchmark PATH_TO_BENCHMARK_RUN_RECORDS
npm run task:public-check
git diff --check
```

Expected results:

- Typecheck, tests, build, CLI smoke, and pack smoke exit 0.
- `doctor --strict --json` reports `staleIndex: 0` and no issue counts for the MDGraph repository.
- `status --storage --json` returns `{ counts, storage }` with database, object, path group, edge kind, high-degree node, and vector sections.
- `bundle create`, `bundle verify`, and `report --json --eval --bundle` return valid private workflow artifacts for the current repository index.
- `diff --base` and `report --base` return a documentation graph impact summary without replacing the current index.
- `report --benchmark` returns paired run-record deltas for a multi-question smoke set, reports incomplete pairs as skipped, and does not require transcripts or agent/model execution.
- `task:public-check` does not find tracked task artifacts under `docs/tasks/` except the allowed public files.
- `git diff --check` is clean. On Windows CRLF files, set repository-local `core.whitespace=cr-at-eol` if needed to avoid false positives on unchanged CRLF endings.
- External corpus smoke is required when scanner, parser, storage, query, MCP, or doctor behavior changes materially. If `MDGRAPH_EXTERNAL_ECC_PATH` is not set, record the skip explicitly.

## Package gate

- Inspect the tarball contents if package metadata or included public docs changed: `npm pack --dry-run`.
- Confirm the package includes `dist`, `README.md`, `CHANGELOG.md`, and `LICENSE`.
- Confirm no `.mdgraph/`, task artifact directory, temp output, local database, or external workspace content is included.

## Note text

- Summarize user-visible CLI/MCP behavior changes.
- Call out output contract changes explicitly.
- Mention known `node:sqlite` experimental warnings only as non-failing runtime warnings.
- Keep external alpha warnings separate from MDGraph repository release blockers.
