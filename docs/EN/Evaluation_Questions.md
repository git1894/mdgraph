# MDGraph Evaluation Questions

These questions turn the plan's agent evaluation guidance into a reusable smoke set. Use them against a realistic project documentation corpus after indexing.

The built-in CLI entry is:

```bash
mdgraph eval --json
mdgraph eval --path /path/to/project --json
```

`mdgraph eval` currently runs the alpha query set and reports pass/fail plus lightweight retrieval metrics. It is a deterministic engineering smoke check, not a completed IR benchmark or real agent A/B benchmark.

1. Why does a specific error code affect a specific user flow?
2. Which older decisions does a given design document depend on?
3. Where is a specific API route defined and where is it referenced?
4. Which runbooks or operational notes are affected by changing a specific config key?
5. Which documents have been superseded by newer designs?
6. Which design assumptions are related to a specific incident report?
7. Which documents correspond to a specific source path?
8. Which documents mention the same entity but do not link to each other?
9. Which design documents are missing `source_refs`?
10. What is the complete documentation chain for a specific feature from requirement to implementation?

## Reference Corpus Expected Records

The repository test fixture `createAlphaFixtureDocs` defines a small reference corpus for these questions. These expected records are deterministic smoke expectations, not a completed real-agent A/B benchmark.

| ID | Query focus | Expected documents | Expected sections | Expected entities | Expected edges | Expected source refs |
|---|---|---|---|---|---|---|
| 1 | `RedisTimeoutError` impact on `LoginFlow` | `docs/redis-cache-design.md`, `docs/login-flow.md`, `docs/runbooks/auth-retry-runbook.md` | `Timeout Handling`, `Login Flow`, `Auth Retry Runbook` | `RedisTimeoutError`, `LoginFlow`, `AuthRetryRunbook` | `REFERENCES`, `DEPENDS_ON` | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 2 | Older decisions for `Auth v2 Design` | `docs/auth-v2-design.md`, `docs/adr/adr-001-cache-failure-policy.md`, `docs/redis-cache-design.md` | `Session Refresh`, `Decision`, `Timeout Handling` | `AuthService`, `CacheFailurePolicy`, `RedisTimeoutError` | `DEPENDS_ON`, `DEFINES` | `src/auth/AuthService.ts`, `src/cache/redis.ts` |
| 3 | Definition and references for `GET /api/auth/login` | `docs/api/login-api.md`, `docs/login-flow.md`, `docs/auth-v2-design.md` | `Login API`, `Login Flow`, `Session Refresh` | `GET /api/auth/login`, `AuthService`, `RedisTimeoutError` | `DEFINES`, `IMPLEMENTS`, `DEPENDS_ON` | `src/routes/auth.ts` |
| 4 | Operational impact of `AUTH_RETRY_LIMIT` | `docs/runbooks/auth-retry-runbook.md`, `docs/redis-cache-design.md`, `docs/login-flow.md` | `Auth Retry Runbook`, `Timeout Handling`, `Login Flow` | `AUTH_RETRY_LIMIT`, `AuthRetryRunbook`, `LoginFlow` | `REFERENCES`, `DEPENDS_ON` | `scripts/restart-auth.ps1` |
| 5 | Superseded design documents | `docs/auth-v2-design.md`, `docs/auth-v3-design.md` | `Session Refresh` in both auth design docs | `AuthService`, `AuthServiceV3` | `SUPERSEDES`, `DEPRECATED_BY` | `src/auth/AuthService.ts`, `src/auth/AuthServiceV3.ts` |
| 6 | Incident-related design assumptions | `docs/incidents/redis-timeout-incident.md`, `docs/redis-cache-design.md`, `docs/runbooks/auth-retry-runbook.md` | `Redis Timeout Incident`, `Timeout Handling`, `Auth Retry Runbook` | `RedisTimeoutError`, `LoginFlow`, `AuthRetryRunbook` | `DEPENDS_ON`, `REFERENCES` | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 7 | Documents for `src/routes/auth.ts` | `docs/api/login-api.md`, `docs/login-flow.md` | `Login API`, `Login Flow` | `GET /api/auth/login`, `LoginFlow` | `IMPLEMENTS`, `DEPENDS_ON` | `src/routes/auth.ts` |
| 8 | Same entity mentions without direct links | `docs/redis-cache-design.md`, `docs/incidents/redis-timeout-incident.md`, `docs/runbooks/auth-retry-runbook.md` | `Timeout Handling`, `Redis Timeout Incident`, `Auth Retry Runbook` | `RedisTimeoutError`, `LoginFlow` | `REFERENCES`, graph-neighbor expansion | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 9 | Designs missing `source_refs` | `docs/auth-v3-design.md` is expected to have `IMPLEMENTS`; no clean-corpus design is expected to have a stale source ref | `Session Refresh` | `AuthServiceV3` | `IMPLEMENTS` | `src/auth/AuthServiceV3.ts` |
| 10 | Requirement-to-implementation chain for login | `docs/login-flow.md`, `docs/api/login-api.md`, `docs/auth-v2-design.md`, `docs/redis-cache-design.md`, `docs/adr/adr-001-cache-failure-policy.md` | `Login Flow`, `Login API`, `Session Refresh`, `Timeout Handling`, `Decision` | `LoginFlow`, `GET /api/auth/login`, `AuthService`, `RedisTimeoutError`, `CacheFailurePolicy` | `DEPENDS_ON`, `IMPLEMENTS`, `DEFINES` | `src/routes/auth.ts`, `src/auth/AuthService.ts`, `src/cache/redis.ts` |

The machine-readable expected records live in `src/evaluation/retrieval-eval.ts` and are covered by `__tests__/evaluation.test.ts`.

## Measurement Notes

For each question, compare agent behavior with and without MDGraph attached:

- Whether the final answer cites the correct documents.
- Number of direct file reads or text searches avoided.
- Whether the answer includes an explainable graph path.
- Whether the context returned by MDGraph is sufficient without follow-up file inspection.
- Time and tool-call count for the full agent run.
- `mdgraph eval` metrics: top-K document recall, expected-section recall, context precision, trace success, latency, returned character count, budget fit, and reason coverage.

The current repository has unit, integration, MCP, CLI, semantic, incremental, doctor, and retrieval-evaluation tests, but it has not yet run a real agent A/B benchmark on these questions.