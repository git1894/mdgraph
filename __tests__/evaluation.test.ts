import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { ALPHA_EVALUATION_CASES, evaluateRetrieval } from "../src/evaluation/retrieval-eval.js";
import { indexProject } from "../src/indexer.js";
import { runDoctor } from "../src/analysis/doctor.js";
import { buildContext } from "../src/query/context-builder.js";
import { searchGraph } from "../src/query/search.js";
import { traceNodes } from "../src/query/trace.js";
import { createAlphaFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("alpha evaluation corpus", () => {
  it("indexes realistic doc kinds and expected graph records", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-alpha-eval-"));
    tempDirs.push(root);
    createAlphaFixtureDocs(root);

    const index = await indexProject(root);
    expect(index.counts.documents).toBe(8);
    expect(index.counts.sourceRefs).toBe(5);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const documents = repository.allDocuments();
      expect(new Set(documents.map((document) => document.type))).toEqual(new Set(["adr", "api", "design", "incident", "runbook", "spec"]));
      expect(repository.allSourceRefs().map((sourceRef) => sourceRef.path).sort()).toEqual([
        "scripts/restart-auth.ps1",
        "src/auth/AuthService.ts",
        "src/auth/AuthServiceV3.ts",
        "src/cache/redis.ts",
        "src/routes/auth.ts"
      ].sort());

      const config = loadConfig(root);
      const search = searchGraph(repository, config, "RedisTimeoutError login", 8);
      expect(search.map((result) => result.document.path)).toContain("docs/redis-cache-design.md");
      expect(search.map((result) => result.document.path)).toContain("docs/login-flow.md");

      const context = buildContext(repository, config, "why does RedisTimeoutError affect LoginFlow");
      expect(context.items.some((item) => item.path === "docs/runbooks/auth-retry-runbook.md")).toBe(true);
      expect(context.items.every((item) => item.reason.length > 0)).toBe(true);

      const supersedes = traceNodes(repository, "Auth v3 Design", "Auth v2 Design", 2);
      expect(supersedes.found).toBe(true);
      expect(supersedes.steps.map((step) => step.edgeKind)).toContain("SUPERSEDES");

      const deprecatedBy = traceNodes(repository, "Auth v2 Design", "Auth v3 Design", 2);
      expect(deprecatedBy.found).toBe(true);
      expect(deprecatedBy.steps.map((step) => step.edgeKind)).toContain("DEPRECATED_BY");

      const implementsSource = traceNodes(repository, "Login API", "src/routes/auth.ts", 2);
      expect(implementsSource.found).toBe(true);
      expect(implementsSource.steps.map((step) => step.edgeKind)).toContain("IMPLEMENTS");

      const storage = repository.storageDiagnostics();
      expect(storage.database.pageSize).toBeGreaterThan(0);
      expect(storage.database.pageCount).toBeGreaterThan(0);
      expect(storage.objects.entries.some((entry) => entry.name === "documents")).toBe(true);
      expect(storage.pathGroups.some((group) => group.group === "docs")).toBe(true);
      expect(storage.edgeKinds.some((item) => item.kind === "DEPENDS_ON")).toBe(true);
      expect(storage.highDegreeNodes.length).toBeGreaterThan(0);
    } finally {
      repository.close();
    }

    const doctor = await runDoctor(root);
    expect(doctor.summary.deadLinks).toBe(0);
    expect(doctor.summary.staleSourceRefs).toBe(0);
    expect(doctor.summary.missingDefinitions).toBe(0);
  });

  it("runs retrieval evaluation cases with metrics and expected records", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-alpha-metrics-"));
    tempDirs.push(root);
    createAlphaFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const report = evaluateRetrieval(repository, loadConfig(root));

      expect(report.querySet).toBe("alpha");
      expect(report.cases).toHaveLength(ALPHA_EVALUATION_CASES.length);
      expect(report.summary.cases).toBe(ALPHA_EVALUATION_CASES.length);
      expect(report.summary.averageTopKDocumentRecall).toBeGreaterThanOrEqual(0);
      expect(report.summary.averageTopKDocumentRecall).toBeLessThanOrEqual(1);
      expect(report.summary.averageExpectedSectionRecall).toBeGreaterThanOrEqual(0);
      expect(report.summary.averageExpectedSectionRecall).toBeLessThanOrEqual(1);
      expect(report.summary.averageContextPrecision).toBeGreaterThanOrEqual(0);
      expect(report.summary.averageContextPrecision).toBeLessThanOrEqual(1);

      const first = report.cases.find((result) => result.id === "alpha-1");
      expect(first?.expected.expectedDocuments).toContain("docs/redis-cache-design.md");
      expect(first?.expected.expectedSections).toContainEqual({ path: "docs/login-flow.md", heading: "Login Flow" });
      expect(first?.expected.expectedEntities).toContain("RedisTimeoutError");
      expect(first?.expected.expectedEdges).toContain("DEPENDS_ON");
      expect(first?.expected.expectedSourceRefs).toContain("src/cache/redis.ts");
      expect(first?.metrics.budgetFit).toBe(true);
      expect(first?.metrics.reasonCoverage).toBe(true);
      expect(first?.metrics.fanout.seedNodes).toBeGreaterThan(0);
      expect(first?.metrics.fanout.visitedNodes).toBeGreaterThanOrEqual(first?.metrics.fanout.seedNodes ?? 0);

      for (const result of report.cases) {
        expect(result.query.length).toBeGreaterThan(0);
        expect(result.metrics.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.metrics.returnedChars).toBeLessThanOrEqual(loadConfig(root).search.maxContextChars);
      }
    } finally {
      repository.close();
    }
  });
});