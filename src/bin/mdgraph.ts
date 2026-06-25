#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { formatDoctorReport, runDoctor, type DoctorWarning, type DoctorWarningSeverity } from "../analysis/doctor.js";
import { collectDoctorScope } from "../analysis/doctor-scope.js";
import { databasePath, initConfig, loadConfig } from "../config/load-config.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type NodeResolution } from "../db/repositories.js";
import { EVALUATION_QUERY_SET_NAMES, evaluateRetrieval } from "../evaluation/retrieval-eval.js";
import { indexProject } from "../indexer.js";
import { startStdioMcpServer } from "../mcp/server.js";
import { buildContext } from "../query/context-builder.js";
import { explainSearchGraph, searchGraph } from "../query/search.js";
import { traceNodes } from "../query/trace.js";
import { packageVersion } from "../version.js";
import { watchProject } from "../watcher/file-watcher.js";

const program = new Command();

program
  .name("mdgraph")
  .description("Local-first Markdown document graph for AI coding workflows")
  .version(packageVersion());

program
  .command("init")
  .description("Create .mdgraph/config.json")
  .option("--docs <glob...>", "Markdown include glob(s)")
  .action((options: { docs?: string[] }) => {
    const target = initConfig(process.cwd(), options.docs);
    console.log(`Created ${target}`);
  });

program
  .command("index")
  .description("Index Markdown documents into the local graph database")
  .option("--json", "Print JSON output")
  .option("--full", "Rebuild the whole index instead of hash-based incremental sync")
  .option("--semantic", "Build local semantic vectors for chunks")
  .action(async (options: { json?: boolean; full?: boolean; semantic?: boolean }) => {
    const result = await indexProject(process.cwd(), { full: options.full, semantic: options.semantic });
    printResult(
      options.json,
      result,
      `Indexed ${result.files} file(s) in ${result.mode} mode. Changed: ${result.changed}, deleted: ${result.deleted}, unchanged: ${result.unchanged}. Documents: ${result.counts.documents}, entities: ${result.counts.entities}, edges: ${result.counts.edges}.`
    );
  });

program
  .command("status")
  .description("Show graph database status")
  .option("--json", "Print JSON output")
  .option("--storage", "Include storage diagnostics")
  .action((options: { json?: boolean; storage?: boolean }) => {
    const projectRoot = validateProjectRoot(process.cwd());
    const database = databasePath(projectRoot);
    if (!fs.existsSync(database)) {
      printResult(
        options.json,
        { indexed: false, projectRoot, database },
        [`MDGraph index status: inactive`, `Project: ${projectRoot}`, `Database: ${database}`, "Run `mdgraph index` to create the local graph."].join("\n")
      );
      return;
    }
    const repository = openRepository();
    try {
      const counts = repository.counts();
      if (options.storage) {
        const storage = repository.storageDiagnostics();
        printResult(options.json, { counts, storage }, formatStatusWithStorage(counts, storage));
        return;
      }
      printResult(options.json, counts, formatStatusCounts(counts));
    } finally {
      closeRepository(repository);
    }
  });

program
  .command("search")
  .description("Search documents, sections, and entities")
  .argument("<query>")
  .option("--json", "Print JSON output")
  .option("--limit <number>", "Maximum results", parseInteger)
  .option("--semantic", "Include local semantic vector matches when vectors are indexed")
  .option("--explain", "Include query parsing and ranking explanation details")
  .action((query: string, options: { json?: boolean; limit?: number; semantic?: boolean; explain?: boolean }) => {
    const config = loadConfig(process.cwd());
    const repository = openRepository();
    try {
      if (options.explain) {
        const explanation = explainSearchGraph(repository, config, query, options.limit ?? config.search.defaultLimit, { semantic: options.semantic });
        printResult(options.json, explanation, formatSearchExplanation(explanation));
        return;
      }
      const results = searchGraph(repository, config, query, options.limit ?? config.search.defaultLimit, { semantic: options.semantic });
      printResult(options.json, results, formatSearchResults(results));
    } finally {
      closeRepository(repository);
    }
  });

program
  .command("context")
  .description("Build an explainable context package for a question")
  .argument("<query>")
  .option("--json", "Print JSON output")
  .option("--debug", "Include context packing and graph expansion debug details")
  .action((query: string, options: { json?: boolean; debug?: boolean }) => {
    const config = loadConfig(process.cwd());
    const repository = openRepository();
    try {
      const context = buildContext(repository, config, query, { debug: options.debug });
      printResult(options.json, context, formatContext(context));
    } finally {
      closeRepository(repository);
    }
  });

program
  .command("node")
  .description("Show a document, entity, source ref, section, or chunk")
  .argument("<query>")
  .option("--json", "Print JSON output")
  .action((query: string, options: { json?: boolean }) => {
    const repository = openRepository();
    try {
      const resolution = repository.resolveNodeDetailed(query);
      printResult(options.json, nodeResolutionJson(resolution), formatNodeResolution(resolution));
    } finally {
      closeRepository(repository);
    }
  });

program
  .command("trace")
  .description("Trace a graph path between two documents, entities, or source refs")
  .argument("<from>")
  .argument("<to>")
  .option("--json", "Print JSON output")
  .option("--depth <number>", "Maximum graph depth", parseInteger)
  .action((from: string, to: string, options: { json?: boolean; depth?: number }) => {
    const repository = openRepository();
    try {
      const trace = traceNodes(repository, from, to, options.depth ?? 6);
      printResult(options.json, trace, formatTrace(trace));
    } finally {
      closeRepository(repository);
    }
  });

program
  .command("eval")
  .description("Run retrieval quality evaluation against an indexed project")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root to evaluate", process.cwd())
  .option("--limit <number>", "Search results per evaluation case", parseInteger)
  .option("--query-set <name>", `Evaluation query set (${EVALUATION_QUERY_SET_NAMES.join(", ")})`, "alpha")
  .action((options: { json?: boolean; path: string; limit?: number; querySet: string }) => {
    const projectRoot = validateProjectRoot(options.path);
    const config = loadConfig(projectRoot);
    const repository = openRepository(projectRoot);
    try {
      const report = evaluateRetrieval(repository, config, { limit: options.limit, querySet: options.querySet });
      printResult(options.json, report, formatEvaluationReport(report));
    } finally {
      closeRepository(repository);
    }
  });

program
  .command("serve")
  .description("Serve MDGraph over the Model Context Protocol")
  .option("--mcp", "Run an MCP server over stdio")
  .option("--path <path>", "Project root to serve", process.cwd())
  .action((options: { mcp?: boolean; path: string }) => {
    if (!options.mcp) {
      throw new Error("Only MCP stdio serving is currently supported. Pass --mcp.");
    }
    startStdioMcpServer({ projectRoot: validateProjectRoot(options.path) });
  });

program
  .command("watch")
  .description("Watch Markdown files and incrementally update the graph index")
  .option("--semantic", "Build local semantic vectors during watch indexing")
  .option("--debounce <ms>", "Debounce delay in milliseconds", parseInteger)
  .action(async (options: { semantic?: boolean; debounce?: number }) => {
    console.error("MDGraph watch started. Press Ctrl+C to stop.");
    const handle = await watchProject(process.cwd(), {
      semantic: options.semantic,
      debounceMs: options.debounce,
      onIndexed: (result) => {
        console.error(`Indexed ${result.changed} changed, ${result.deleted} deleted, ${result.unchanged} unchanged document(s).`);
      },
      onError: (error) => {
        console.error(`Watch indexing failed: ${error.message}`);
      }
    });
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
    await handle.close();
  });

program
  .command("doctor")
  .description("Analyze documentation graph health and governance issues")
  .option("--json", "Print JSON output")
  .option("--strict", "Exit with a non-zero status if any issue is reported")
  .option("--fail-on <severity>", "Exit with non-zero status when warnings at or above severity exist (error, warn, info)")
  .option("--changed", "Limit doctor output to changed Markdown paths in the Git worktree")
  .option("--since <ref>", "Limit doctor output to Markdown paths changed since a Git ref")
  .action(async (options: { json?: boolean; strict?: boolean; failOn?: string; changed?: boolean; since?: string }) => {
    if (options.changed && options.since) {
      throw new Error("Use either --changed or --since <ref>, not both.");
    }
    const failOn = parseDoctorSeverity(options.failOn);
    const scope = options.changed
      ? collectDoctorScope(process.cwd(), { mode: "changed" })
      : options.since
        ? collectDoctorScope(process.cwd(), { mode: "since", baseRef: options.since })
        : undefined;
    const report = await runDoctor(process.cwd(), { scope });
    printResult(options.json, report, formatDoctorReport(report));
    if (options.strict && doctorIssueCount(report.summary) > 0) {
      process.exitCode = 1;
    }
    if (failOn && doctorWarningsAtOrAbove(report.warnings, failOn)) {
      process.exitCode = 1;
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function openRepository(projectRoot = process.cwd()): GraphRepository {
  return new GraphRepository(openExistingDatabase(validateProjectRoot(projectRoot)));
}

function closeRepository(repository: GraphRepository): void {
  repository.close();
}

function printResult(json: boolean | undefined, value: unknown, text: string): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(text);
}

function formatStatusCounts(counts: ReturnType<GraphRepository["counts"]>): string {
  return `Documents: ${counts.documents}, sections: ${counts.sections}, entities: ${counts.entities}, edges: ${counts.edges}, chunks: ${counts.chunks}, vectors: ${counts.vectors}.`;
}

function formatStatusWithStorage(
  counts: ReturnType<GraphRepository["counts"]>,
  storage: ReturnType<GraphRepository["storageDiagnostics"]>
): string {
  const wal = storage.database.walCheckpoint.available
    ? `WAL pages: ${storage.database.walCheckpoint.log}, checkpointed: ${storage.database.walCheckpoint.checkpointed}`
    : `WAL status unavailable: ${storage.database.walCheckpoint.reason}`;
  return [
    formatStatusCounts(counts),
    `Storage: ${formatBytes(storage.database.estimatedBytes)} (${storage.database.pageCount} pages, ${storage.database.freelistCount} freelist pages, ${storage.database.journalMode} journal).`,
    wal,
    `Objects: ${storage.objects.entries.length} tracked${storage.objects.dbstatAvailable ? " with dbstat sizes" : " without dbstat sizes"}.`,
    `Top path groups: ${storage.pathGroups.slice(0, 5).map((item) => `${item.group}=${formatBytes(item.contentBytes)}`).join(", ") || "none"}.`,
    `Edge kinds: ${storage.edgeKinds.map((item) => `${item.kind}=${item.edges}`).join(", ") || "none"}.`,
    `Vectors: ${storage.vectors.total}.`
  ].join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatSearchResults(results: ReturnType<typeof searchGraph>): string {
  if (!results.length) {
    return "No results.";
  }
  return results
    .map((result, index) => {
      const heading = result.section ? `#${result.section.anchor}` : "";
      return `${index + 1}. ${result.document.path}${heading} - ${result.reason}`;
    })
    .join("\n");
}

function formatSearchExplanation(explanation: ReturnType<typeof explainSearchGraph>): string {
  const entityLines = explanation.matchedEntities.length
    ? explanation.matchedEntities.map((entity) => `- ${entity.name} (${entity.kind}) in ${entity.documentFrequency} document(s)`)
    : ["- none"];
  const resultLines = explanation.results.length
    ? explanation.results.map((result, index) => `${index + 1}. ${result.document.path}${result.section ? `#${result.section.anchor}` : ""} score=${result.score.toFixed(2)} reason=${result.reason}`)
    : ["No results."];
  return [
    `Query: ${explanation.query}`,
    `FTS query: ${explanation.ftsQuery || "none"}`,
    `Entity candidates: ${explanation.entityCandidates.join(", ") || "none"}`,
    `Semantic enabled: ${explanation.semanticEnabled}`,
    "Matched entities:",
    ...entityLines,
    "Results:",
    ...resultLines
  ].join("\n");
}

function formatContext(context: ReturnType<typeof buildContext>): string {
  if (!context.items.length) {
    return "No context found.";
  }
  const items = context.items
    .map((item, index) => {
      const heading = item.heading ? `# ${item.heading}` : item.title;
      const lines = item.lines ? `:${item.lines.start}` : "";
      return `## ${index + 1}. ${item.path}${lines}\nReason: ${item.reason}\n${heading}\n${item.content}`;
    })
    .join("\n\n");
  if (!context.debug) {
    return items;
  }
  return [
    items,
    "",
    "## Debug",
    `Seed nodes: ${context.debug.seedNodes}`,
    `Visited nodes: ${context.debug.visitedNodes}`,
    `Expanded edges: ${context.debug.expandedEdges}`,
    `Candidates: ${context.debug.candidateCount} (${context.debug.directCandidates} direct, ${context.debug.expandedCandidates} expanded)`,
    `Skipped visited: ${context.debug.skippedVisitedNodes}, node-limit: ${context.debug.skippedByNodeLimit}, depth: ${context.debug.skippedByDepth}`,
    `Budget truncated items: ${context.debug.budgetTruncatedItems}, skipped items: ${context.debug.budgetSkippedItems}`
  ].join("\n");
}

function formatTrace(trace: ReturnType<typeof traceNodes>): string {
  if (!trace.found) {
    return trace.message ?? "No path found.";
  }
  return trace.steps
    .map((step, index) => `${index + 1}. ${formatTraceStep(step)}`)
    .join("\n");
}

function formatEvaluationReport(report: ReturnType<typeof evaluateRetrieval>): string {
  const lines = [
    `Evaluation query set: ${report.querySet}`,
    `Cases: ${report.summary.cases}, passed: ${report.summary.passed}, failed: ${report.summary.failed}`,
    `Average top-K document recall: ${formatMetric(report.summary.averageTopKDocumentRecall)}`,
    `Average expected-section recall: ${formatMetric(report.summary.averageExpectedSectionRecall)}`,
    `Average context precision: ${formatMetric(report.summary.averageContextPrecision)}`,
    `Average latency: ${report.summary.averageLatencyMs.toFixed(1)} ms`,
    "",
    ...report.cases.map((result) => {
      const status = result.passed ? "pass" : "fail";
      return [
        `${result.id}: ${status}`,
        `  query: ${result.query}`,
        `  topKDocumentRecall=${formatMetric(result.metrics.topKDocumentRecall)}, expectedSectionRecall=${formatMetric(result.metrics.expectedSectionRecall)}, contextPrecision=${formatMetric(result.metrics.contextPrecision)}`,
        `  traceSuccess=${result.metrics.traceSuccess ?? "n/a"}, returnedChars=${result.metrics.returnedChars}, budgetFit=${result.metrics.budgetFit}`
      ].join("\n");
    })
  ];
  return lines.join("\n");
}

function formatMetric(value: number): string {
  return value.toFixed(2);
}

function nodeResolutionJson(resolution: NodeResolution): unknown {
  if (resolution.status === "found") {
    return resolution.node;
  }
  if (resolution.status === "ambiguous") {
    return { error: resolution.error, query: resolution.query, candidates: resolution.candidates };
  }
  return { error: resolution.error, query: resolution.query };
}

function formatNodeResolution(resolution: NodeResolution): string {
  if (resolution.status === "found") {
    return `${resolution.node.kind}: ${resolution.node.label}`;
  }
  if (resolution.status === "ambiguous") {
    const candidates = resolution.candidates
      .map((candidate) => `- ${candidate.documentPath}#${candidate.anchor}:${candidate.line} (${candidate.heading})`)
      .join("\n");
    return `Ambiguous section query: ${resolution.query}\n${candidates}`;
  }
  return `Node not found: ${resolution.query}`;
}

function formatTraceStep(step: ReturnType<typeof traceNodes>["steps"][number]): string {
  const edge = `${step.edgeKind}/${step.provenance}/${step.confidence}`;
  return step.traversalDirection === "forward"
    ? `${step.fromLabel} --${edge}--> ${step.toLabel}`
    : `${step.fromLabel} <--${edge}-- ${step.toLabel}`;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function doctorIssueCount(summary: Awaited<ReturnType<typeof runDoctor>>["summary"]): number {
  return Object.entries(summary)
    .filter(([key]) => key !== "documents")
    .reduce((total, [, value]) => total + Number(value), 0);
}

function parseDoctorSeverity(value: string | undefined): DoctorWarningSeverity | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "error" || value === "warn" || value === "info") {
    return value;
  }
  throw new Error(`Expected --fail-on to be one of error, warn, or info; got ${value}`);
}

function doctorWarningsAtOrAbove(warnings: DoctorWarning[], severity: DoctorWarningSeverity): boolean {
  const threshold = doctorSeverityRank(severity);
  return warnings.some((warning) => doctorSeverityRank(warning.severity) <= threshold);
}

function doctorSeverityRank(severity: DoctorWarningSeverity): number {
  return severity === "error" ? 0 : severity === "warn" ? 1 : 2;
}

function validateProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Project root does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project root is not a directory: ${resolved}`);
  }
  return resolved;
}
