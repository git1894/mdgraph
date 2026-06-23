# MDGraph Release Checklist

Use this checklist before publishing an MDGraph release or asking a maintainer to cut one. It complements [CHANGELOG.md](../../CHANGELOG.md), [Output_Contracts.md](Output_Contracts.md), [Alpha_Results.md](Alpha_Results.md), and the task public check described in [docs/tasks/README.md](../tasks/README.md).

## Public checks

- Confirm `package.json` version and CLI `program.version(...)` match.
- Confirm [CHANGELOG.md](../../CHANGELOG.md) has an entry for the release.
- Review README quick start, requirements, MCP setup, output contracts, and known tradeoffs when public CLI/MCP behavior changed.
- Refresh [Alpha_Results.md](Alpha_Results.md) when parser, scanner, storage, query, MCP, or doctor behavior changes materially on external corpora.

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
npm run task:public-check
git diff --check
```

Expected results:

- Typecheck, tests, build, CLI smoke, and pack smoke exit 0.
- `doctor --strict --json` reports `staleIndex: 0` and no issue counts for the MDGraph repository.
- `status --storage --json` returns `{ counts, storage }` with database, object, path group, edge kind, high-degree node, and vector sections.
- `task:public-check` does not find tracked task artifacts under `docs/tasks/` except the allowed public files.
- `git diff --check` is clean. On Windows CRLF files, set repository-local `core.whitespace=cr-at-eol` if needed to avoid false positives on unchanged CRLF endings.

## Package gate

- Inspect the tarball contents if package metadata changed: `npm pack --dry-run`.
- Confirm the package includes `dist`, `README.md`, `CHANGELOG.md`, and `LICENSE`.
- Confirm no `.mdgraph/`, task artifact directory, temp output, local database, or external workspace content is included.

## Note text

- Summarize user-visible CLI/MCP behavior changes.
- Call out output contract changes explicitly.
- Mention known `node:sqlite` experimental warnings only as non-failing runtime warnings.
- Keep external alpha warnings separate from MDGraph repository release blockers.