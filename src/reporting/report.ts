import fs from "node:fs";
import path from "node:path";
import { runDoctor } from "../analysis/doctor.js";
import { formatBenchmarkReport, loadBenchmarkReport, type BenchmarkReport } from "../benchmark/benchmark.js";
import { verifyGraphBundle, type BundleVerificationResult, sourceSnapshot } from "../bundle/bundle.js";
import { databasePath, loadConfig } from "../config/load-config.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type StatusCounts, type StorageDiagnostics } from "../db/repositories.js";
import { generateGraphDiff, type GraphDiffReport } from "../diff/graph-diff.js";
import { evaluateRetrieval, type EvaluationReport } from "../evaluation/retrieval-eval.js";
import { packageVersion } from "../version.js";

export interface MDGraphReport {
  projectRoot: string;
  generatedAt: string;
  mdgraphVersion: string;
  indexed: boolean;
  schema?: ReturnType<GraphRepository["schemaMetadata"]>;
  counts?: StatusCounts;
  storage?: StorageDiagnostics;
  source?: {
    sourceHash: string;
    configHash: string;
    documents: number;
    documentsHash: string;
  };
  doctor?: {
    summary: Awaited<ReturnType<typeof runDoctor>>["summary"];
    warningCounts: Record<string, number>;
    topWarnings: Array<{ code: string; count: number }>;
  };
  eval?: {
    querySet: string;
    summary: EvaluationReport["summary"];
    ranking: EvaluationReport["ranking"];
  };
  bundle?: BundleVerificationResult;
  diff?: GraphDiffReport;
  benchmark?: BenchmarkReport;
  trend: {
    state: "first_run" | "previous_report_loaded" | "previous_report_missing";
    previousReport?: string;
  };
}

export async function generateReport(
  projectRoot: string,
  options: { eval?: boolean; bundle?: string; base?: string; benchmark?: string; previousReport?: string } = {}
): Promise<MDGraphReport> {
  const resolvedRoot = path.resolve(projectRoot);
  const generatedAt = new Date().toISOString();
  const report: MDGraphReport = {
    projectRoot: resolvedRoot,
    generatedAt,
    mdgraphVersion: packageVersion(),
    indexed: fs.existsSync(databasePath(resolvedRoot)),
    trend: trendState(options.previousReport)
  };

  if (!report.indexed) {
    if (options.bundle) {
      report.bundle = verifyGraphBundle(options.bundle, { projectRoot: resolvedRoot });
    }
    if (options.benchmark) {
      report.benchmark = loadBenchmarkReport(options.benchmark);
    }
    return report;
  }

  const config = loadConfig(resolvedRoot);
  const repository = new GraphRepository(openExistingDatabase(resolvedRoot));
  try {
    report.schema = repository.schemaMetadata();
    report.counts = repository.counts();
    report.storage = repository.storageDiagnostics();
    const source = sourceSnapshot(config, repository.allDocuments().map((document) => ({ path: document.path, hash: document.hash })));
    report.source = {
      sourceHash: source.sourceHash,
      configHash: source.configHash,
      documents: source.documents.length,
      documentsHash: source.documentsHash
    };
    if (options.eval) {
      const evalReport = evaluateRetrieval(repository, config);
      report.eval = {
        querySet: evalReport.querySet,
        summary: evalReport.summary,
        ranking: evalReport.ranking
      };
    }
  } finally {
    repository.close();
  }

  const doctor = await runDoctor(resolvedRoot);
  report.doctor = {
    summary: doctor.summary,
    warningCounts: warningCounts(doctor.warnings),
    topWarnings: topWarningCounts(doctor.warnings)
  };
  if (options.bundle) {
    report.bundle = verifyGraphBundle(options.bundle, { projectRoot: resolvedRoot });
  }
  if (options.base) {
    report.diff = await generateGraphDiff(resolvedRoot, { base: options.base });
  }
  if (options.benchmark) {
    report.benchmark = loadBenchmarkReport(options.benchmark);
  }
  return report;
}

export function formatReport(report: MDGraphReport): string {
  const lines = [
    "MDGraph report",
    `Project: ${report.projectRoot}`,
    `Generated: ${report.generatedAt}`,
    `Version: ${report.mdgraphVersion}`,
    `Indexed: ${report.indexed}`
  ];

  if (!report.indexed) {
    lines.push("Run `mdgraph index` before relying on graph health or evaluation summaries.");
    if (report.benchmark) {
      lines.push(formatBenchmarkReport(report.benchmark));
    }
    lines.push(`Trend: ${report.trend.state}.`);
    return lines.join("\n");
  }

  if (report.counts) {
    lines.push(`Documents: ${report.counts.documents}, sections: ${report.counts.sections}, entities: ${report.counts.entities}, edges: ${report.counts.edges}.`);
  }
  if (report.schema) {
    lines.push(`Schema: v${report.schema.schemaVersion} (${report.schema.baseline} baseline).`);
  }
  if (report.doctor) {
    lines.push(`Doctor issues: ${doctorIssueCount(report.doctor.summary)}.`);
    lines.push(`Top warnings: ${report.doctor.topWarnings.map((item) => `${item.code}=${item.count}`).join(", ") || "none"}.`);
  }
  if (report.eval) {
    lines.push(`Eval ${report.eval.querySet}: ${report.eval.summary.passed}/${report.eval.summary.cases} passed, average latency ${report.eval.summary.averageLatencyMs.toFixed(1)} ms.`);
  }
  if (report.bundle) {
    lines.push(`Bundle: ${report.bundle.valid ? "valid" : "invalid"} (${report.bundle.freshness.state}: ${report.bundle.freshness.reason}).`);
    if (report.bundle.errors.length) {
      lines.push(...report.bundle.errors.map((error) => `- ${error}`));
    }
  }
  if (report.diff) {
    lines.push(`Diff ${report.diff.base.ref}: +${report.diff.summary.documentsAdded}, ~${report.diff.summary.documentsModified}, -${report.diff.summary.documentsDeleted}, renamed ${report.diff.summary.documentsRenamed}.`);
    lines.push(...report.diff.impact.prSummary.map((item) => `- ${item}`));
  }
  if (report.benchmark) {
    lines.push(formatBenchmarkReport(report.benchmark));
  }
  lines.push(`Trend: ${report.trend.state}.`);
  return lines.join("\n");
}

function trendState(previousReport: string | undefined): MDGraphReport["trend"] {
  if (!previousReport) {
    return { state: "first_run" };
  }
  return fs.existsSync(previousReport)
    ? { state: "previous_report_loaded", previousReport: path.resolve(previousReport) }
    : { state: "previous_report_missing", previousReport: path.resolve(previousReport) };
}

function warningCounts(warnings: Awaited<ReturnType<typeof runDoctor>>["warnings"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  }
  return counts;
}

function topWarningCounts(warnings: Awaited<ReturnType<typeof runDoctor>>["warnings"]): Array<{ code: string; count: number }> {
  return Object.entries(warningCounts(warnings))
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    .slice(0, 5);
}

function doctorIssueCount(summary: Awaited<ReturnType<typeof runDoctor>>["summary"]): number {
  return Object.entries(summary)
    .filter(([key]) => key !== "documents")
    .reduce((total, [, value]) => total + Number(value), 0);
}
