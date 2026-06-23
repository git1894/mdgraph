---
description: "Use when implementing features, fixing bugs, refactoring, changing architecture, adding dependencies, or reviewing MDGraph changes for AI over-engineering. Enforces the smallest correct change while preserving MDGraph contracts, security, and tests."
name: "Minimal Correct Change"
applyTo: ["src/**/*.ts", "__tests__/**/*.ts", "docs/**/*.md", "package.json", "tsconfig.json", "AGENTS.md", ".github/instructions/**/*.md"]
---

# Minimal Correct Change Guardrail

- Apply the user-level `minimal-correct-change` skill for implementation, bug fixes, refactors, and review tasks when relevant.
- Treat it as a guardrail, not an override: MDGraph architecture, public contracts, testing requirements, security rules, and explicit user requests take precedence.
- Before adding code, check whether deleting code, reusing existing module boundaries, Node.js standard APIs, SQLite constraints, or existing dependencies solves the current need.
- Avoid new abstractions, dependencies, config knobs, services, or cross-module layers unless they remove real current duplication, simplify a concrete contract, or support an existing second use case.
- Prefer focused edits inside existing MDGraph modules over new cross-module layers.
- Use `overengineering-review` for diff/plan complexity review and `overengineering-audit` for repo-wide simplification audits.
- For non-trivial logic, leave the smallest focused test or runnable check that would fail if the behavior regresses.
