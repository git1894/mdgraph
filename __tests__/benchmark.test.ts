import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateBenchmarkReport, loadBenchmarkReport, parseAgentRunRecords, type AgentRunRecord } from "../src/benchmark/benchmark.js";
import { generateReport } from "../src/reporting/report.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("v0.6.3 benchmark report", () => {
  it("pairs with/without MDGraph records and calculates deltas", () => {
    const records = [
      runRecord({
        id: "with-alpha-10",
        questionId: "alpha-10",
        mode: "with_mdgraph",
        toolCalls: [{ name: "mdgraph_context", outputChars: 1200 }],
        mdgraphCalls: [{ tool: "mdgraph_context", query: "LoginFlow chain", resultCount: 5, chars: 1200 }],
        finalCitations: [
          { path: "docs/login-flow.md" },
          { path: "docs/api/login-api.md" }
        ],
        characterBudget: 1200,
        latencyMs: 900
      }),
      runRecord({
        id: "without-alpha-10",
        questionId: "alpha-10",
        mode: "without_mdgraph",
        toolCalls: [
          { name: "rg", outputChars: 500 },
          { name: "read_file", outputChars: 1000 },
          { name: "read_file", outputChars: 1000 },
          { name: "read_file", outputChars: 1000 },
          { name: "read_file", outputChars: 1000 },
          { name: "read_file", outputChars: 1000 }
        ],
        directFileReads: [
          { path: "docs/login-flow.md", chars: 1000 },
          { path: "docs/api/login-api.md", chars: 1000 },
          { path: "docs/auth-v2-design.md", chars: 1000 },
          { path: "docs/redis-cache-design.md", chars: 1000 },
          { path: "docs/adr/adr-001-cache-failure-policy.md", chars: 1000 }
        ],
        textSearches: [{ query: "LoginFlow", resultCount: 8 }],
        finalCitations: [
          { path: "docs/login-flow.md" },
          { path: "docs/unrelated.md" }
        ],
        rawFileFallback: true,
        characterBudget: 5500,
        latencyMs: 2500
      })
    ];

    const report = generateBenchmarkReport(records);

    expect(report.summary.completePairs).toBe(1);
    expect(report.summary.skippedPairs).toBe(0);
    expect(report.pairs[0]?.delta.directFileReads).toBe(-5);
    expect(report.pairs[0]?.delta.directFileReadChars).toBe(-5000);
    expect(report.pairs[0]?.delta.textSearches).toBe(-1);
    expect(report.pairs[0]?.delta.toolCalls).toBe(-5);
    expect(report.pairs[0]?.delta.mdgraphCalls).toBe(1);
    expect(report.pairs[0]?.delta.characterBudget).toBe(-4300);
    expect(report.pairs[0]?.delta.latencyMs).toBe(-1600);
    expect(report.pairs[0]?.withMdgraph.citations.correctnessRate).toBe(1);
    expect(report.pairs[0]?.withoutMdgraph.citations.correctnessRate).toBe(0.5);
  });

  it("reports incomplete, duplicate, and mismatched pairs as skipped", () => {
    const records = [
      runRecord({ id: "only-with", questionId: "only", mode: "with_mdgraph" }),
      runRecord({ id: "dup-with-1", questionId: "dup", mode: "with_mdgraph" }),
      runRecord({ id: "dup-with-2", questionId: "dup", mode: "with_mdgraph" }),
      runRecord({ id: "dup-without", questionId: "dup", mode: "without_mdgraph" }),
      runRecord({ id: "mismatch-with", questionId: "mismatch", question: "First wording", mode: "with_mdgraph" }),
      runRecord({ id: "mismatch-without", questionId: "mismatch", question: "Second wording", mode: "without_mdgraph" })
    ];

    const report = generateBenchmarkReport(records);

    expect(report.summary.completePairs).toBe(0);
    expect(report.summary.skippedPairs).toBe(3);
    expect(report.skipped.map((item) => item.questionId)).toEqual(["dup", "mismatch", "only"]);
    expect(report.skipped.find((item) => item.questionId === "mismatch")?.reason).toBe("question_text_mismatch");
  });

  it("excludes unknown citations from correctness percentage", () => {
    const report = generateBenchmarkReport([
      runRecord({
        id: "custom-with",
        questionId: "custom",
        mode: "with_mdgraph",
        finalCitations: [
          { path: "docs/a.md", correct: true },
          { path: "docs/b.md", correct: "unknown" },
          { path: "docs/c.md" }
        ]
      }),
      runRecord({
        id: "custom-without",
        questionId: "custom",
        mode: "without_mdgraph",
        finalCitations: [
          { path: "docs/a.md", correct: false },
          { path: "docs/b.md", correct: "unknown" }
        ]
      })
    ]);

    expect(report.pairs[0]?.withMdgraph.citations.correct).toBe(1);
    expect(report.pairs[0]?.withMdgraph.citations.unknown).toBe(2);
    expect(report.pairs[0]?.withMdgraph.citations.correctnessRate).toBe(1);
    expect(report.pairs[0]?.withoutMdgraph.citations.correctnessRate).toBe(0);
    expect(report.pairs[0]?.delta.citationCorrectnessRate).toBe(1);
  });

  it("rejects malformed run records and embeds benchmark input in report", async () => {
    expect(() => parseAgentRunRecords([{
      id: "missing-question-id",
      question: "Missing question id",
      mode: "with_mdgraph",
      startedAt: "2026-06-26T00:00:00.000Z",
      completedAt: "2026-06-26T00:00:01.000Z",
      toolCalls: [],
      directFileReads: [],
      textSearches: [],
      mdgraphCalls: [],
      finalCitations: [],
      rawFileFallback: false,
      latencyMs: 1
    }])).toThrow(/questionId/);

    const root = makeTempRoot("mdgraph-benchmark-report-");
    const input = path.join(root, "benchmark.json");
    fs.writeFileSync(input, JSON.stringify({ runs: [
      runRecord({ id: "with", questionId: "custom", mode: "with_mdgraph", finalCitations: [{ path: "docs/a.md", correct: true }] }),
      runRecord({ id: "without", questionId: "custom", mode: "without_mdgraph", finalCitations: [{ path: "docs/a.md", correct: true }] })
    ] }, null, 2), "utf8");

    const report = await generateReport(root, { benchmark: input });

    expect(report.indexed).toBe(false);
    expect(report.benchmark?.summary.completePairs).toBe(1);
  });

  it("rejects benchmark JSON inputs that exceed structure budgets", () => {
    const root = makeTempRoot("mdgraph-benchmark-budget-");
    const input = path.join(root, "deep-benchmark.json");
    fs.writeFileSync(input, nestedJson(130), "utf8");

    expect(() => loadBenchmarkReport(input)).toThrow(/JSON depth/);
  });
});

function runRecord(overrides: Partial<AgentRunRecord>): AgentRunRecord {
  return {
    id: overrides.id ?? `${overrides.mode ?? "with_mdgraph"}-record`,
    questionId: overrides.questionId ?? "alpha-1",
    question: overrides.question ?? "What is the complete documentation chain for a feature?",
    mode: overrides.mode ?? "with_mdgraph",
    startedAt: overrides.startedAt ?? "2026-06-26T00:00:00.000Z",
    completedAt: overrides.completedAt ?? "2026-06-26T00:00:01.000Z",
    toolCalls: overrides.toolCalls ?? [],
    directFileReads: overrides.directFileReads ?? [],
    textSearches: overrides.textSearches ?? [],
    mdgraphCalls: overrides.mdgraphCalls ?? [],
    finalCitations: overrides.finalCitations ?? [],
    rawFileFallback: overrides.rawFileFallback ?? false,
    tokenEstimate: overrides.tokenEstimate,
    characterBudget: overrides.characterBudget,
    latencyMs: overrides.latencyMs ?? 1000,
    notes: overrides.notes
  };
}

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function nestedJson(depth: number): string {
  let value = "\"leaf\"";
  for (let index = 0; index < depth; index += 1) {
    value = `{"child":${value}}`;
  }
  return value;
}
