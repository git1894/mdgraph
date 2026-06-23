import { performance } from "node:perf_hooks";
import type { EdgeKind, SearchResult } from "../types.js";
import type { GraphRepository } from "../db/repositories.js";
import type { MDGraphConfig } from "../types.js";
import type { ContextResult } from "../query/context-builder.js";
import { buildContext } from "../query/context-builder.js";
import { searchGraph } from "../query/search.js";
import { traceNodes, type TraceResult } from "../query/trace.js";
import { slugifyHeading } from "../utils/text.js";

export interface EvaluationSectionExpectation {
  path: string;
  heading: string;
}

export interface EvaluationTraceExpectation {
  from: string;
  to: string;
  depth?: number;
  edgeKinds: EdgeKind[];
}

export interface EvaluationCase {
  id: string;
  query: string;
  expectedDocuments: string[];
  expectedSections: EvaluationSectionExpectation[];
  expectedEntities: string[];
  expectedEdges: EdgeKind[];
  expectedSourceRefs: string[];
  trace?: EvaluationTraceExpectation;
}

export interface EvaluationMetrics {
  topKDocumentRecall: number;
  expectedSectionRecall: number;
  contextPrecision: number;
  entityRecall: number;
  sourceRefRecall: number;
  edgeKindCoverage: number;
  traceSuccess: boolean | null;
  latencyMs: number;
  returnedChars: number;
  budgetFit: boolean;
  fanout: {
    seedNodes: number;
    visitedNodes: number;
    expandedEdges: number;
    skippedByNodeLimit: number;
    skippedByDepth: number;
  };
  reasonCoverage: boolean;
}

export interface EvaluationCaseResult {
  id: string;
  query: string;
  passed: boolean;
  expected: Omit<EvaluationCase, "id" | "query" | "trace">;
  observed: {
    searchDocuments: string[];
    contextItems: Array<{ path: string; heading?: string; reason: string }>;
    matchedEntities: string[];
    resolvedEntities: string[];
    resolvedSourceRefs: string[];
    edgeKinds: EdgeKind[];
    trace?: TraceResult;
  };
  metrics: EvaluationMetrics;
}

export interface EvaluationSummary {
  cases: number;
  passed: number;
  failed: number;
  averageTopKDocumentRecall: number;
  averageExpectedSectionRecall: number;
  averageContextPrecision: number;
  averageLatencyMs: number;
  averageReturnedChars: number;
}

export interface EvaluationReport {
  querySet: string;
  limit: number;
  generatedAt: string;
  summary: EvaluationSummary;
  cases: EvaluationCaseResult[];
}

export const EVALUATION_QUERY_SET_NAMES = ["alpha", "ecc"] as const;
export type EvaluationQuerySet = typeof EVALUATION_QUERY_SET_NAMES[number];

export const ALPHA_EVALUATION_CASES: EvaluationCase[] = [
  {
    id: "alpha-1",
    query: "Why does RedisTimeoutError affect LoginFlow?",
    expectedDocuments: ["docs/redis-cache-design.md", "docs/login-flow.md", "docs/runbooks/auth-retry-runbook.md"],
    expectedSections: [
      { path: "docs/redis-cache-design.md", heading: "Timeout Handling" },
      { path: "docs/login-flow.md", heading: "Login Flow" },
      { path: "docs/runbooks/auth-retry-runbook.md", heading: "Auth Retry Runbook" }
    ],
    expectedEntities: ["RedisTimeoutError", "LoginFlow", "AuthRetryRunbook"],
    expectedEdges: ["REFERENCES", "DEPENDS_ON"],
    expectedSourceRefs: ["src/cache/redis.ts", "scripts/restart-auth.ps1"],
    trace: { from: "LoginFlow", to: "RedisTimeoutError", depth: 6, edgeKinds: ["DEPENDS_ON"] }
  },
  {
    id: "alpha-2",
    query: "Which older decisions does Auth v2 Design depend on?",
    expectedDocuments: ["docs/auth-v2-design.md", "docs/adr/adr-001-cache-failure-policy.md", "docs/redis-cache-design.md"],
    expectedSections: [
      { path: "docs/auth-v2-design.md", heading: "Session Refresh" },
      { path: "docs/adr/adr-001-cache-failure-policy.md", heading: "Decision" },
      { path: "docs/redis-cache-design.md", heading: "Timeout Handling" }
    ],
    expectedEntities: ["AuthService", "CacheFailurePolicy", "RedisTimeoutError"],
    expectedEdges: ["DEPENDS_ON", "DEFINES"],
    expectedSourceRefs: ["src/auth/AuthService.ts", "src/cache/redis.ts"],
    trace: { from: "Auth v2 Design", to: "CacheFailurePolicy", depth: 4, edgeKinds: ["DEPENDS_ON", "DEFINES"] }
  },
  {
    id: "alpha-3",
    query: "Where is GET /api/auth/login defined and referenced?",
    expectedDocuments: ["docs/api/login-api.md", "docs/login-flow.md", "docs/auth-v2-design.md"],
    expectedSections: [
      { path: "docs/api/login-api.md", heading: "Login API" },
      { path: "docs/login-flow.md", heading: "Login Flow" },
      { path: "docs/auth-v2-design.md", heading: "Session Refresh" }
    ],
    expectedEntities: ["GET /api/auth/login", "AuthService", "RedisTimeoutError"],
    expectedEdges: ["DEFINES", "IMPLEMENTS", "DEPENDS_ON"],
    expectedSourceRefs: ["src/routes/auth.ts"],
    trace: { from: "Login API", to: "src/routes/auth.ts", depth: 2, edgeKinds: ["IMPLEMENTS"] }
  },
  {
    id: "alpha-4",
    query: "Which runbooks are affected by AUTH_RETRY_LIMIT?",
    expectedDocuments: ["docs/runbooks/auth-retry-runbook.md", "docs/redis-cache-design.md", "docs/login-flow.md"],
    expectedSections: [
      { path: "docs/runbooks/auth-retry-runbook.md", heading: "Auth Retry Runbook" },
      { path: "docs/redis-cache-design.md", heading: "Timeout Handling" },
      { path: "docs/login-flow.md", heading: "Login Flow" }
    ],
    expectedEntities: ["AUTH_RETRY_LIMIT", "AuthRetryRunbook", "LoginFlow"],
    expectedEdges: ["REFERENCES", "DEPENDS_ON"],
    expectedSourceRefs: ["scripts/restart-auth.ps1"],
    trace: { from: "AuthRetryRunbook", to: "LoginFlow", depth: 5, edgeKinds: ["REFERENCES", "DEPENDS_ON"] }
  },
  {
    id: "alpha-5",
    query: "Which design documents have been superseded by newer designs?",
    expectedDocuments: ["docs/auth-v2-design.md", "docs/auth-v3-design.md"],
    expectedSections: [
      { path: "docs/auth-v2-design.md", heading: "Session Refresh" },
      { path: "docs/auth-v3-design.md", heading: "Session Refresh" }
    ],
    expectedEntities: ["AuthService", "AuthServiceV3"],
    expectedEdges: ["SUPERSEDES", "DEPRECATED_BY"],
    expectedSourceRefs: ["src/auth/AuthService.ts", "src/auth/AuthServiceV3.ts"],
    trace: { from: "Auth v3 Design", to: "Auth v2 Design", depth: 2, edgeKinds: ["SUPERSEDES"] }
  },
  {
    id: "alpha-6",
    query: "Which design assumptions are related to the Redis Timeout Incident?",
    expectedDocuments: ["docs/incidents/redis-timeout-incident.md", "docs/redis-cache-design.md", "docs/runbooks/auth-retry-runbook.md"],
    expectedSections: [
      { path: "docs/incidents/redis-timeout-incident.md", heading: "Redis Timeout Incident" },
      { path: "docs/redis-cache-design.md", heading: "Timeout Handling" },
      { path: "docs/runbooks/auth-retry-runbook.md", heading: "Auth Retry Runbook" }
    ],
    expectedEntities: ["RedisTimeoutError", "LoginFlow", "AuthRetryRunbook"],
    expectedEdges: ["DEPENDS_ON", "REFERENCES"],
    expectedSourceRefs: ["src/cache/redis.ts", "scripts/restart-auth.ps1"],
    trace: { from: "Redis Timeout Incident", to: "AuthRetryRunbook", depth: 5, edgeKinds: ["DEPENDS_ON", "REFERENCES"] }
  },
  {
    id: "alpha-7",
    query: "Which documents correspond to src/routes/auth.ts?",
    expectedDocuments: ["docs/api/login-api.md", "docs/login-flow.md"],
    expectedSections: [
      { path: "docs/api/login-api.md", heading: "Login API" },
      { path: "docs/login-flow.md", heading: "Login Flow" }
    ],
    expectedEntities: ["GET /api/auth/login", "LoginFlow"],
    expectedEdges: ["IMPLEMENTS", "DEPENDS_ON"],
    expectedSourceRefs: ["src/routes/auth.ts"],
    trace: { from: "src/routes/auth.ts", to: "LoginFlow", depth: 5, edgeKinds: ["IMPLEMENTS", "DEPENDS_ON"] }
  },
  {
    id: "alpha-8",
    query: "Which documents mention RedisTimeoutError but do not link directly?",
    expectedDocuments: ["docs/redis-cache-design.md", "docs/incidents/redis-timeout-incident.md", "docs/runbooks/auth-retry-runbook.md"],
    expectedSections: [
      { path: "docs/redis-cache-design.md", heading: "Timeout Handling" },
      { path: "docs/incidents/redis-timeout-incident.md", heading: "Redis Timeout Incident" },
      { path: "docs/runbooks/auth-retry-runbook.md", heading: "Auth Retry Runbook" }
    ],
    expectedEntities: ["RedisTimeoutError", "LoginFlow"],
    expectedEdges: ["REFERENCES"],
    expectedSourceRefs: ["src/cache/redis.ts", "scripts/restart-auth.ps1"],
    trace: { from: "Redis Timeout Incident", to: "RedisTimeoutError", depth: 4, edgeKinds: ["REFERENCES", "DEPENDS_ON"] }
  },
  {
    id: "alpha-9",
    query: "Which design documents are missing source_refs?",
    expectedDocuments: ["docs/auth-v3-design.md"],
    expectedSections: [{ path: "docs/auth-v3-design.md", heading: "Session Refresh" }],
    expectedEntities: ["AuthServiceV3"],
    expectedEdges: ["IMPLEMENTS"],
    expectedSourceRefs: ["src/auth/AuthServiceV3.ts"],
    trace: { from: "Auth v3 Design", to: "src/auth/AuthServiceV3.ts", depth: 2, edgeKinds: ["IMPLEMENTS"] }
  },
  {
    id: "alpha-10",
    query: "What is the documentation chain for LoginFlow from requirement to implementation?",
    expectedDocuments: [
      "docs/login-flow.md",
      "docs/api/login-api.md",
      "docs/auth-v2-design.md",
      "docs/redis-cache-design.md",
      "docs/adr/adr-001-cache-failure-policy.md"
    ],
    expectedSections: [
      { path: "docs/login-flow.md", heading: "Login Flow" },
      { path: "docs/api/login-api.md", heading: "Login API" },
      { path: "docs/auth-v2-design.md", heading: "Session Refresh" },
      { path: "docs/redis-cache-design.md", heading: "Timeout Handling" },
      { path: "docs/adr/adr-001-cache-failure-policy.md", heading: "Decision" }
    ],
    expectedEntities: ["LoginFlow", "GET /api/auth/login", "AuthService", "RedisTimeoutError", "CacheFailurePolicy"],
    expectedEdges: ["DEPENDS_ON", "IMPLEMENTS", "DEFINES"],
    expectedSourceRefs: ["src/routes/auth.ts", "src/auth/AuthService.ts", "src/cache/redis.ts"],
    trace: { from: "LoginFlow", to: "src/auth/AuthService.ts", depth: 6, edgeKinds: ["DEPENDS_ON", "IMPLEMENTS"] }
  }
];

export const ECC_EVALUATION_CASES: EvaluationCase[] = [
  pathOnlyCase(
    "ecc-1",
    "CLAUDE.md Project Overview Key Commands Development Notes",
    ["CLAUDE.md"]
  ),
  pathOnlyCase(
    "ecc-2",
    "hooks.json memory persistence SessionStart PreCompact observation activity tracking SessionEnd",
    ["hooks/README.md"]
  ),
  pathOnlyCase(
    "ecc-3",
    "legacy command shims tdd eval verify migration compatibility canonical skills",
    ["legacy-command-shims/README.md"]
  ),
  pathOnlyCase(
    "ecc-4",
    "ECC 2.0 Session Adapter Discovery passthrough native projection adapter",
    ["docs/ECC-2.0-SESSION-ADAPTER-DISCOVERY.md"]
  ),
  pathOnlyCase(
    "ecc-5",
    "selective install architecture manifest install plan apply target component modules",
    ["docs/SELECTIVE-INSTALL-ARCHITECTURE.md"]
  ),
  pathOnlyCase(
    "ecc-6",
    "Supply Chain Incident Response security secrets AgentShield",
    ["docs/security/supply-chain-incident-response.md"]
  ),
  pathOnlyCase(
    "ecc-7",
    "Quality Gate Command post quality gate hook formatter",
    ["commands/quality-gate.md"]
  ),
  pathOnlyCase(
    "ecc-8",
    "review context code review security performance test coverage",
    ["contexts/review.md"]
  )
];

export function evaluationCasesForQuerySet(querySet: string): EvaluationCase[] {
  switch (querySet) {
    case "alpha":
      return ALPHA_EVALUATION_CASES;
    case "ecc":
      return ECC_EVALUATION_CASES;
    default:
      throw new Error(`Unknown evaluation query set: ${querySet}. Expected one of: ${EVALUATION_QUERY_SET_NAMES.join(", ")}.`);
  }
}

export function evaluateRetrieval(
  repository: GraphRepository,
  config: MDGraphConfig,
  options: { cases?: EvaluationCase[]; limit?: number; querySet?: string } = {}
): EvaluationReport {
  const querySet = options.querySet ?? "alpha";
  const cases = options.cases ?? evaluationCasesForQuerySet(querySet);
  const limit = options.limit ?? config.search.defaultLimit;
  const results = cases.map((evaluationCase) => evaluateCase(repository, config, evaluationCase, limit));
  return {
    querySet,
    limit,
    generatedAt: new Date().toISOString(),
    summary: summarize(results),
    cases: results
  };
}

function pathOnlyCase(id: string, query: string, expectedDocuments: string[]): EvaluationCase {
  return {
    id,
    query,
    expectedDocuments,
    expectedSections: [],
    expectedEntities: [],
    expectedEdges: [],
    expectedSourceRefs: []
  };
}

function evaluateCase(
  repository: GraphRepository,
  config: MDGraphConfig,
  evaluationCase: EvaluationCase,
  limit: number
): EvaluationCaseResult {
  const start = performance.now();
  const searchResults = searchGraph(repository, config, evaluationCase.query, limit);
  const context = buildContext(repository, config, evaluationCase.query, { debug: true });
  const trace = evaluationCase.trace
    ? traceNodes(repository, evaluationCase.trace.from, evaluationCase.trace.to, evaluationCase.trace.depth ?? config.search.maxDepth)
    : undefined;
  const latencyMs = performance.now() - start;

  const searchDocuments = unique(searchResults.map((result) => result.document.path));
  const contextItems = context.items.map((item) => ({ path: item.path, heading: item.heading, reason: item.reason }));
  const matchedEntities = unique(searchResults.flatMap((result) => result.matchedEntities.map((entity) => entity.name)));
  const resolvedEntities = resolveExpected(repository, evaluationCase.expectedEntities, "entity");
  const resolvedSourceRefs = resolveExpected(repository, evaluationCase.expectedSourceRefs, "source_ref");
  const edgeKinds = observedEdgeKinds(repository, trace);
  const metrics = calculateMetrics({
    evaluationCase,
    searchResults,
    context,
    trace,
    latencyMs,
    resolvedEntities,
    resolvedSourceRefs,
    edgeKinds
  });

  return {
    id: evaluationCase.id,
    query: evaluationCase.query,
    passed: casePassed(metrics),
    expected: {
      expectedDocuments: evaluationCase.expectedDocuments,
      expectedSections: evaluationCase.expectedSections,
      expectedEntities: evaluationCase.expectedEntities,
      expectedEdges: evaluationCase.expectedEdges,
      expectedSourceRefs: evaluationCase.expectedSourceRefs
    },
    observed: {
      searchDocuments,
      contextItems,
      matchedEntities,
      resolvedEntities,
      resolvedSourceRefs,
      edgeKinds,
      trace
    },
    metrics
  };
}

function calculateMetrics(input: {
  evaluationCase: EvaluationCase;
  searchResults: SearchResult[];
  context: ContextResult;
  trace: TraceResult | undefined;
  latencyMs: number;
  resolvedEntities: string[];
  resolvedSourceRefs: string[];
  edgeKinds: EdgeKind[];
}): EvaluationMetrics {
  const expectedDocumentSet = new Set(input.evaluationCase.expectedDocuments);
  const returnedDocuments = unique(input.searchResults.map((result) => result.document.path));
  const contextMatches = input.context.items.filter((item) => expectedDocumentSet.has(item.path));
  const observedSectionKeys = new Set(input.context.items.map((item) => sectionKey(item.path, item.heading)));
  const traceSuccess = input.evaluationCase.trace
    ? Boolean(input.trace?.found) && expectedCovered(input.evaluationCase.trace.edgeKinds, input.trace?.steps.map((step) => step.edgeKind) ?? []) === 1
    : null;

  return {
    topKDocumentRecall: expectedCovered(input.evaluationCase.expectedDocuments, returnedDocuments),
    expectedSectionRecall: expectedCovered(input.evaluationCase.expectedSections.map(sectionExpectationKey), [...observedSectionKeys]),
    contextPrecision: input.context.items.length ? contextMatches.length / input.context.items.length : 0,
    entityRecall: expectedCovered(input.evaluationCase.expectedEntities, input.resolvedEntities),
    sourceRefRecall: expectedCovered(input.evaluationCase.expectedSourceRefs, input.resolvedSourceRefs),
    edgeKindCoverage: expectedCovered(input.evaluationCase.expectedEdges, input.edgeKinds),
    traceSuccess,
    latencyMs: roundMetric(input.latencyMs),
    returnedChars: input.context.usedChars,
    budgetFit: input.context.usedChars <= input.context.maxChars,
    fanout: {
      seedNodes: input.context.debug?.seedNodes ?? 0,
      visitedNodes: input.context.debug?.visitedNodes ?? 0,
      expandedEdges: input.context.debug?.expandedEdges ?? 0,
      skippedByNodeLimit: input.context.debug?.skippedByNodeLimit ?? 0,
      skippedByDepth: input.context.debug?.skippedByDepth ?? 0
    },
    reasonCoverage: input.searchResults.every((result) => result.reason.length > 0) && input.context.items.every((item) => item.reason.length > 0)
  };
}

function summarize(results: EvaluationCaseResult[]): EvaluationSummary {
  const count = results.length || 1;
  return {
    cases: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    averageTopKDocumentRecall: average(results.map((result) => result.metrics.topKDocumentRecall), count),
    averageExpectedSectionRecall: average(results.map((result) => result.metrics.expectedSectionRecall), count),
    averageContextPrecision: average(results.map((result) => result.metrics.contextPrecision), count),
    averageLatencyMs: average(results.map((result) => result.metrics.latencyMs), count),
    averageReturnedChars: average(results.map((result) => result.metrics.returnedChars), count)
  };
}

function casePassed(metrics: EvaluationMetrics): boolean {
  return metrics.topKDocumentRecall === 1
    && metrics.expectedSectionRecall === 1
    && metrics.entityRecall === 1
    && metrics.sourceRefRecall === 1
    && metrics.edgeKindCoverage === 1
    && metrics.budgetFit
    && metrics.reasonCoverage
    && metrics.traceSuccess !== false;
}

function resolveExpected(repository: GraphRepository, values: string[], expectedKind: "entity" | "source_ref"): string[] {
  return values.filter((value) => repository.resolveNode(value)?.kind === expectedKind);
}

function observedEdgeKinds(repository: GraphRepository, trace: TraceResult | undefined): EdgeKind[] {
  const graphEdgeKinds = repository.storageDiagnostics().edgeKinds.map((item) => item.kind);
  const traceEdgeKinds = trace?.steps.map((step) => step.edgeKind) ?? [];
  return unique([...graphEdgeKinds, ...traceEdgeKinds]);
}

function expectedCovered(expected: string[], observed: string[]): number {
  if (!expected.length) {
    return 1;
  }
  const observedSet = new Set(observed);
  return roundMetric(expected.filter((item) => observedSet.has(item)).length / expected.length);
}

function sectionExpectationKey(section: EvaluationSectionExpectation): string {
  return sectionKey(section.path, section.heading);
}

function sectionKey(path: string, heading: string | undefined): string {
  return `${path}#${slugifyHeading(heading ?? "")}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function average(values: number[], count: number): number {
  return roundMetric(values.reduce((total, value) => total + value, 0) / count);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}