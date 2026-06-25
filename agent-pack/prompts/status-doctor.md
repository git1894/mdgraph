# Status And Doctor Prompt

Use this when the user asks whether MDGraph is ready, stale, healthy, or suitable for a documentation-gated workflow.

1. Call `mdgraph_status` first.
2. If status is inactive, explain that normal file tools should be used unless the user asks to run `mdgraph index`.
3. If status is active, use its counts and `fresh` / `stale` / `unknown` freshness metadata as a lightweight readiness check.
4. If the user asks about broken docs, CI gates, health risks, or full stale-index hash verification, run CLI `mdgraph doctor --json` rather than relying on `mdgraph_status` alone.
5. When reporting issues, cite affected document paths and the remediation hint from the doctor output.

Do not create, refresh, or repair an index unless the user explicitly asks.