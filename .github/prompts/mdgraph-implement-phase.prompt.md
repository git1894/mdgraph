---
description: "Implement one MDGraph capability aligned with the current architecture, with scoped code changes, tests, and verification."
name: "Implement MDGraph Capability"
argument-hint: "Capability or bugfix, such as context ranking or MCP input validation"
agent: "agent"
---

Implement the requested MDGraph capability.

First read `docs/EN/Architecture.md`, then inspect the relevant source files, tests, and README command surface to identify the smallest implementation slice that satisfies the request.

Follow these constraints:

- Preserve the current local-first MDGraph boundary unless the user explicitly expands scope.
- Prefer deterministic Markdown/front matter/link/entity extraction over LLM or cloud-dependent behavior.
- Keep `source_refs`, `IMPLEMENTS`, graph explanations, and context budgets in scope when they are relevant to the requested capability.
- Add focused tests before or alongside the implementation.
- Run the most relevant validation command available in the project and report any gaps if the project is not scaffolded yet.

Return a concise summary with changed files, verification results, and any remaining risks.