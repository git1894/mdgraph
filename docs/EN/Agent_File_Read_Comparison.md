# Agent File-Read Comparison Notes

These notes record early 0.3 evidence for query-first, file-read-second agent workflows. They are engineering case notes, not a completed real-agent A/B benchmark.

For the v0.6 structured benchmark contract, use `mdgraph report --benchmark benchmark-runs.json --json`. That report consumes paired `with_mdgraph` / `without_mdgraph` run records and calculates aggregate deltas without storing full transcripts.

## Method

The comparison uses two deterministic sources already in the repository:

- The alpha evaluation records in [Evaluation_Questions.md](Evaluation_Questions.md). Their expected documents are treated as the minimum direct Markdown file reads a raw-file workflow would need after it already knew the correct targets.
- The ECC external alpha smoke in [Alpha_Results.md](Alpha_Results.md). Its context result is treated as an observed MDGraph large-corpus retrieval case.

This method intentionally does not claim final-answer quality, elapsed wall time, or actual host-agent behavior. Those require a later real A/B run with captured tool transcripts.

## Case 1: Requirement-To-Implementation Chain

Question: `What is the documentation chain for LoginFlow from requirement to implementation?`

Source: alpha evaluation case `alpha-10`.

Without MDGraph, a raw-file workflow must inspect at least these five expected Markdown documents after discovery:

- `docs/login-flow.md`
- `docs/api/login-api.md`
- `docs/auth-v2-design.md`
- `docs/redis-cache-design.md`
- `docs/adr/adr-001-cache-failure-policy.md`

With MDGraph, the intended first step is one `mdgraph_context` call for the task text. A follow-up `mdgraph_trace` can explain the path from `LoginFlow` to `src/auth/AuthService.ts` when the agent needs the relationship chain rather than only packed context.

Recorded read delta: at least `5` direct Markdown reads become `1` context call plus optional trace.

## Case 2: Source Path To Documentation

Question: `Which documents correspond to src/routes/auth.ts?`

Source: alpha evaluation case `alpha-7`.

Without MDGraph, a raw-file workflow must first discover references to `src/routes/auth.ts`, then inspect at least these two expected Markdown documents:

- `docs/api/login-api.md`
- `docs/login-flow.md`

With MDGraph, the intended first step is `mdgraph_context` with `knownFiles: ["src/routes/auth.ts"]`, or `mdgraph_trace` from `src/routes/auth.ts` to `LoginFlow` when the relationship is the requested output.

Recorded read delta: at least `2` direct Markdown reads plus discovery search become `1` context or trace call.

## Case 3: ECC Large Workflow Corpus

Question: `How are skills and rules organized for agent workflow?`

Source: ECC external alpha smoke in [Alpha_Results.md](Alpha_Results.md).

Observed MDGraph result:

- `mdgraph context "How are skills and rules organized for agent workflow?" --json`
- Packed `26` context items.
- Used `14076` of `28000` characters.
- Top context paths included `skills/ui-demo/SKILL.md`, `docs/ANTIGRAVITY-GUIDE.md`, `docs/business/team-agent-orchestration-content-pack.md`, `skills/skill-comply/SKILL.md`, `CLAUDE.md`, and `README.md`.

Without MDGraph, a raw-file workflow would need broad text search and direct inspection of multiple top-ranked documents. A conservative lower bound using only the top listed context paths is `6` direct Markdown reads after discovery.

Recorded read delta: at least `6` direct Markdown reads after discovery become `1` context call on a 2205-document external corpus.

## Follow-Up Measurement

The v0.6 benchmark report should capture structured run records for the same questions and compare:

- Direct file reads and text searches.
- MDGraph tool calls.
- Final cited documents.
- Whether raw file fallback was still required.
- Time and token budget.

Full transcripts should stay outside public docs. These notes remain scoped design evidence; the reproducible A/B surface is the structured `report --benchmark` input/output contract.
