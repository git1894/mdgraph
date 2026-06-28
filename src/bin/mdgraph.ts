#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { formatDoctorReport, runDoctor, type DoctorWarning, type DoctorWarningSeverity } from "../analysis/doctor.js";
import { collectDoctorScope } from "../analysis/doctor-scope.js";
import { computeStatusFreshness, type StatusFreshness } from "../analysis/status-freshness.js";
import { createGraphBundle, verifyGraphBundle } from "../bundle/bundle.js";
import { databasePath, initProjectConfig, loadConfig } from "../config/load-config.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type NodeResolution } from "../db/repositories.js";
import { formatGraphDiff, generateGraphDiff } from "../diff/graph-diff.js";
import { EVALUATION_QUERY_SET_NAMES, evaluateRetrieval } from "../evaluation/retrieval-eval.js";
import { buildMermaidTraceExport } from "../export/diagram.js";
import { buildGraphJsonExport, formatGraphJsonVerification, readGraphJsonFile, stableGraphJson, verifyGraphJsonExport } from "../export/graphjson.js";
import { buildDocsSiteIndex, formatObsidianMarkdownIndex } from "../export/markdown-index.js";
import { buildCodeGraphBridgeReport, type SourceBridgeReport } from "../export/source-bridge.js";
import { indexProject, type IndexResult } from "../indexer.js";
import { startStdioMcpServer } from "../mcp/server.js";
import { buildContext } from "../query/context-builder.js";
import { explainSearchGraph, searchGraph } from "../query/search.js";
import { traceNodes } from "../query/trace.js";
import { formatReport, generateReport } from "../reporting/report.js";
import { semanticStatusReport, type SemanticStatusReport } from "../semantic/status.js";
import type { SearchQueryMode } from "../types.js";
import { packageVersion } from "../version.js";
import { watchProject } from "../watcher/file-watcher.js";

const program = new Command();

program
  .name("mdgraph")
  .description("Local-first Markdown document graph for AI coding workflows")
  .version(packageVersion());

program
  .command("usage")
  .description("Print agent-friendly MDGraph workflows and command examples")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root to use in examples. Defaults to the current working directory")
  .action((options: { json?: boolean; path?: string }) => {
    const guide = buildUsageGuide(projectRootFromOption(options.path));
    printResult(options.json, guide, formatUsageGuide(guide));
  });

program
  .command("init")
  .description("Create .mdgraph/config.json and build the initial index")
  .option("--docs <glob...>", "Markdown include glob(s)")
  .option("--no-index", "Skip initial indexing after writing config")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { docs?: string[]; index?: boolean; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const result = initProjectConfig(projectRoot, options.docs);
    const configStatus = result.configCreated ? "Created" : "Already exists";
    const gitignoreStatus = result.gitignoreUpdated ? "Updated" : "Already protected";
    console.log(`${configStatus} ${result.configPath}`);
    console.log(`${gitignoreStatus} ${result.gitignorePath}`);
    if (options.index === false) {
      console.log("Skipped initial index. Run `mdgraph index` to create the local graph.");
      return;
    }
    const index = await indexProject(projectRoot);
    console.log(formatIndexResult(index));
  });

program
  .command("index")
  .description("Index Markdown documents into the local graph database")
  .option("--json", "Print JSON output")
  .option("--full", "Rebuild the whole index instead of hash-based incremental sync")
  .option("--semantic", "Build local semantic vectors for chunks")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { json?: boolean; full?: boolean; semantic?: boolean; path?: string }) => {
    const result = await indexProject(projectRootFromOption(options.path), { full: options.full, semantic: options.semantic });
    printResult(options.json, result, formatIndexResult(result));
  });

program
  .command("status")
  .description("Show graph database status")
  .option("--json", "Print JSON output")
  .option("--storage", "Include storage diagnostics")
  .option("--freshness", "Include lightweight index freshness diagnostics")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((options: { json?: boolean; storage?: boolean; freshness?: boolean; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const database = databasePath(projectRoot);
    if (!fs.existsSync(database)) {
      printResult(
        options.json,
        { indexed: false, projectRoot, database },
        [`MDGraph index status: inactive`, `Project: ${projectRoot}`, `Database: ${database}`, "Run `mdgraph index` to create the local graph."].join("\n")
      );
      return;
    }
    const repository = openRepository(projectRoot);
    try {
      const counts = repository.counts();
      const freshness = options.freshness ? computeStatusFreshness(projectRoot, loadConfig(projectRoot), repository) : undefined;
      if (options.storage) {
        const storage = repository.storageDiagnostics();
        printResult(options.json, freshness ? { counts, storage, freshness } : { counts, storage }, formatStatusWithStorage(counts, storage, freshness));
        return;
      }
      if (freshness) {
        printResult(options.json, { counts, freshness }, formatStatusWithFreshness(counts, freshness));
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
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((query: string, options: { json?: boolean; limit?: number; semantic?: boolean; explain?: boolean; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const config = loadConfig(projectRoot);
    const repository = openRepository(projectRoot);
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
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((query: string, options: { json?: boolean; debug?: boolean; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const config = loadConfig(projectRoot);
    const repository = openRepository(projectRoot);
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
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((query: string, options: { json?: boolean; path?: string }) => {
    const repository = openRepository(projectRootFromOption(options.path));
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
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((from: string, to: string, options: { json?: boolean; depth?: number; path?: string }) => {
    const repository = openRepository(projectRootFromOption(options.path));
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
  .option("--query-mode <mode>", "Search query mode for evaluation (auto, keyword, semantic)", parseSearchQueryMode, "auto")
  .action((options: { json?: boolean; path: string; limit?: number; querySet: string; queryMode: SearchQueryMode }) => {
    const projectRoot = validateProjectRoot(options.path);
    const config = loadConfig(projectRoot);
    const repository = openRepository(projectRoot);
    try {
      const report = evaluateRetrieval(repository, config, { limit: options.limit, querySet: options.querySet, queryMode: options.queryMode });
      printResult(options.json, report, formatEvaluationReport(report));
    } finally {
      closeRepository(repository);
    }
  });

const semanticCommand = program
  .command("semantic")
  .description("Inspect optional semantic vector indexing");

semanticCommand
  .command("status")
  .description("Show semantic provider, vector coverage, and reindex guidance")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root to inspect", process.cwd())
  .action((options: { json?: boolean; path: string }) => {
    const projectRoot = validateProjectRoot(options.path);
    const config = loadConfig(projectRoot);
    if (!fs.existsSync(databasePath(projectRoot))) {
      const report = semanticStatusReport(config, undefined, undefined);
      printResult(options.json, { projectRoot, ...report }, formatSemanticStatus(projectRoot, report));
      return;
    }

    const repository = openRepository(projectRoot);
    try {
      const report = semanticStatusReport(config, repository.counts(), repository.storageDiagnostics());
      printResult(options.json, { projectRoot, ...report }, formatSemanticStatus(projectRoot, report));
    } finally {
      closeRepository(repository);
    }
  });

const bundleCommand = program
  .command("bundle")
  .description("Create and verify reusable local graph bundle artifacts");

bundleCommand
  .command("create")
  .description("Create a private directory bundle from the current graph")
  .option("--json", "Print JSON output")
  .option("--profile <profile>", "Bundle profile", "private")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { json?: boolean; profile: string; path?: string }) => {
    const result = await createGraphBundle(projectRootFromOption(options.path), { profile: options.profile });
    printResult(options.json, result, formatBundleCreate(result));
  });

bundleCommand
  .command("verify")
  .description("Verify a graph bundle directory")
  .argument("<dir>")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root for freshness comparison. Defaults to the current working directory")
  .action((dir: string, options: { json?: boolean; path?: string }) => {
    const result = verifyGraphBundle(dir, { projectRoot: projectRootFromOption(options.path) });
    printResult(options.json, result, formatBundleVerify(result));
    if (!result.valid) {
      process.exitCode = 1;
    }
  });

const exportCommand = program
  .command("export")
  .description("Export MDGraph interoperability artifacts");

exportCommand
  .command("graphjson")
  .description("Export a deterministic structural GraphJSON view")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((options: { json?: boolean; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const repository = openRepository(projectRoot);
    try {
      const graph = buildGraphJsonExport(projectRoot, repository);
      if (options.json) {
        printResult(true, graph, "");
        return;
      }
      process.stdout.write(stableGraphJson(graph));
    } finally {
      closeRepository(repository);
    }
  });

const exportMermaidCommand = exportCommand
  .command("mermaid")
  .description("Export deterministic Mermaid diagrams");

exportMermaidCommand
  .command("trace")
  .description("Export a Mermaid trace path diagram")
  .argument("<from>")
  .argument("<to>")
  .option("--json", "Print JSON output")
  .option("--depth <number>", "Maximum graph depth", parseInteger)
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((from: string, to: string, options: { json?: boolean; depth?: number; path?: string }) => {
    const repository = openRepository(projectRootFromOption(options.path));
    try {
      const trace = traceNodes(repository, from, to, options.depth ?? 6);
      const result = buildMermaidTraceExport(trace);
      printResult(options.json, result, result.diagram);
    } finally {
      closeRepository(repository);
    }
  });

exportCommand
  .command("markdown-index")
  .description("Export an Obsidian-friendly Markdown graph index")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((options: { path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const repository = openRepository(projectRoot);
    try {
      const graph = buildGraphJsonExport(projectRoot, repository);
      console.log(formatObsidianMarkdownIndex(graph));
    } finally {
      closeRepository(repository);
    }
  });

exportCommand
  .command("docs-site")
  .description("Export lightweight docs-site graph data")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((options: { json?: boolean; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    const repository = openRepository(projectRoot);
    try {
      const graph = buildGraphJsonExport(projectRoot, repository);
      const index = buildDocsSiteIndex(graph);
      printResult(options.json, index, JSON.stringify(index, null, 2));
    } finally {
      closeRepository(repository);
    }
  });

exportCommand
  .command("source-bridge")
  .description("Export a read-only source bridge report")
  .option("--json", "Print JSON output")
  .option("--provider <provider>", "Bridge provider", "codegraph")
  .option("--artifact <file>", "Read-only provider artifact to inspect")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action((options: { json?: boolean; provider: string; artifact?: string; path?: string }) => {
    if (options.provider !== "codegraph") {
      throw new Error(`Unsupported source bridge provider: ${options.provider}. MDGraph 0.7 supports the codegraph read-only bridge spike.`);
    }
    const repository = openRepository(projectRootFromOption(options.path));
    try {
      const report = buildCodeGraphBridgeReport(repository, { artifact: options.artifact });
      printResult(options.json, report, formatSourceBridgeReport(report));
    } finally {
      closeRepository(repository);
    }
  });

const importCommand = program
  .command("import")
  .description("Inspect external MDGraph interoperability artifacts without writing the local index");

importCommand
  .command("graphjson")
  .description("Verify a GraphJSON export")
  .argument("<file>")
  .option("--json", "Print JSON output")
  .option("--verify", "Verify only; required because GraphJSON merge import is not supported")
  .action((file: string, options: { json?: boolean; verify?: boolean }) => {
    if (!options.verify) {
      throw new Error("GraphJSON import is verify-only in MDGraph 0.7. Pass --verify.");
    }
    let value: unknown;
    try {
      value = readGraphJsonFile(file);
    } catch (error) {
      const result = {
        valid: false,
        errors: [{
          code: "graphjson.read_failed",
          message: `Failed to read GraphJSON file: ${error instanceof Error ? error.message : String(error)}`,
          remediation: "Pass a readable JSON file exported by `mdgraph export graphjson --json`."
        }],
        warnings: []
      };
      printResult(options.json, result, formatGraphJsonVerification(result));
      process.exitCode = 1;
      return;
    }
    const result = verifyGraphJsonExport(value);
    printResult(options.json, result, formatGraphJsonVerification(result));
    if (!result.valid) {
      process.exitCode = 1;
    }
  });

program
  .command("diff")
  .description("Compare the current graph index against a base Git revision")
  .requiredOption("--base <ref>", "Base Git revision")
  .option("--json", "Print JSON output")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { base: string; json?: boolean; path?: string }) => {
    const report = await generateGraphDiff(projectRootFromOption(options.path), { base: options.base });
    printResult(options.json, report, formatGraphDiff(report));
  });

program
  .command("report")
  .description("Generate a CI-friendly graph health and workflow report")
  .option("--json", "Print JSON output")
  .option("--eval", "Include retrieval evaluation summary")
  .option("--bundle <dir>", "Include bundle verification summary")
  .option("--base <ref>", "Include graph diff summary against a base Git revision")
  .option("--benchmark <file>", "Include paired agent benchmark summary from structured run records")
  .option("--previous-report <file>", "Explicit previous report JSON for trend context")
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { json?: boolean; eval?: boolean; bundle?: string; base?: string; benchmark?: string; previousReport?: string; path?: string }) => {
    const report = await generateReport(projectRootFromOption(options.path), {
      eval: options.eval,
      bundle: options.bundle,
      base: options.base,
      benchmark: options.benchmark,
      previousReport: options.previousReport
    });
    printResult(options.json, report, formatReport(report));
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
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { semantic?: boolean; debounce?: number; path?: string }) => {
    const projectRoot = projectRootFromOption(options.path);
    console.error("MDGraph watch started. Press Ctrl+C to stop.");
    const handle = await watchProject(projectRoot, {
      semantic: options.semantic,
      debounceMs: options.debounce,
      onIndexed: (result) => {
        console.error(`Indexed ${result.changed} changed, ${result.deleted} deleted, ${result.unchanged} unchanged, ${result.skipped} skipped document(s).`);
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
  .option("--path <path>", "Project root. Defaults to the current working directory")
  .action(async (options: { json?: boolean; strict?: boolean; failOn?: string; changed?: boolean; since?: string; path?: string }) => {
    if (options.changed && options.since) {
      throw new Error("Use either --changed or --since <ref>, not both.");
    }
    const failOn = parseDoctorSeverity(options.failOn);
    const projectRoot = projectRootFromOption(options.path);
    const scope = options.changed
      ? collectDoctorScope(projectRoot, { mode: "changed" })
      : options.since
        ? collectDoctorScope(projectRoot, { mode: "since", baseRef: options.since })
        : undefined;
    const report = await runDoctor(projectRoot, { scope });
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

interface UsageGuide {
  projectRoot: string;
  commonOptions: Array<{ flag: string; description: string }>;
  workflows: Array<{ name: string; purpose: string; commands: string[]; notes?: string[] }>;
}

function buildUsageGuide(projectRoot: string): UsageGuide {
  const project = shellPath(projectRoot);
  return {
    projectRoot,
    commonOptions: [
      { flag: "--path <project>", description: "Run against an explicit project root; defaults to the current working directory." },
      { flag: "--json", description: "Print machine-readable output when the command supports structured output." }
    ],
    workflows: [
      {
        name: "Initialize",
        purpose: "Create configuration, protect local artifacts, and build the initial graph index.",
        commands: [
          `mdgraph init --path ${project}`,
          `mdgraph init --path ${project} --docs "docs/**/*.md"`,
          `mdgraph init --path ${project} --no-index`
        ]
      },
      {
        name: "Refresh Index",
        purpose: "Update the local graph after Markdown changes.",
        commands: [
          `mdgraph index --path ${project}`,
          `mdgraph index --path ${project} --full`,
          `mdgraph index --path ${project} --full --semantic`
        ],
        notes: ["`index` is hash-based incremental by default; use `--full` for a rebuild and compaction."]
      },
      {
        name: "Check Health",
        purpose: "Inspect availability, storage, freshness, and documentation-health warnings.",
        commands: [
          `mdgraph status --path ${project} --json`,
          `mdgraph status --path ${project} --freshness --json`,
          `mdgraph status --path ${project} --storage --freshness --json`,
          `mdgraph doctor --path ${project} --json`,
          `mdgraph doctor --path ${project} --strict`
        ],
        notes: ["`node:sqlite` experimental warnings are informational when the command exits successfully."]
      },
      {
        name: "Task Start",
        purpose: "Gather explainable context before reading multiple Markdown files manually.",
        commands: [
          `mdgraph context "what should I read before changing indexing?" --path ${project}`,
          `mdgraph search "indexing config" --path ${project} --explain --json`,
          `mdgraph node "docs/EN/Architecture.md" --path ${project}`,
          `mdgraph trace "Architecture.md" "src/indexer.ts" --path ${project}`
        ]
      },
      {
        name: "CI And Artifacts",
        purpose: "Produce reproducible graph reports and interoperability artifacts.",
        commands: [
          `mdgraph report --path ${project} --json`,
          `mdgraph diff --path ${project} --base main --json`,
          `mdgraph export graphjson --path ${project} --json`,
          `mdgraph bundle create --path ${project} --profile private --json`
        ]
      },
      {
        name: "Help",
        purpose: "Inspect syntax for all commands or a specific command.",
        commands: ["mdgraph help", "mdgraph help search", "mdgraph usage --json"]
      }
    ]
  };
}

function formatUsageGuide(guide: UsageGuide): string {
  const workflows = guide.workflows.map((workflow) => {
    const notes = workflow.notes?.length ? ["Notes:", ...workflow.notes.map((note) => `- ${note}`)] : [];
    return [
      `## ${workflow.name}`,
      workflow.purpose,
      "Commands:",
      ...workflow.commands.map((command) => `- ${command}`),
      ...notes
    ].join("\n");
  });
  return [
    "MDGraph usage",
    `Project: ${guide.projectRoot}`,
    "Common options:",
    ...guide.commonOptions.map((option) => `- ${option.flag}: ${option.description}`),
    "",
    ...workflows
  ].join("\n\n");
}

function shellPath(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function projectRootFromOption(projectRoot: string | undefined): string {
  return validateProjectRoot(projectRoot ?? process.cwd());
}

function formatIndexResult(result: IndexResult): string {
  return `Indexed ${result.files} file(s) in ${result.mode} mode. Changed: ${result.changed}, deleted: ${result.deleted}, unchanged: ${result.unchanged}, skipped: ${result.skipped}. Documents: ${result.counts.documents}, entities: ${result.counts.entities}, edges: ${result.counts.edges}.`;
}

function formatStatusCounts(counts: ReturnType<GraphRepository["counts"]>): string {
  return `Documents: ${counts.documents}, sections: ${counts.sections}, entities: ${counts.entities}, edges: ${counts.edges}, chunks: ${counts.chunks}, vectors: ${counts.vectors}.`;
}

function formatStatusWithStorage(
  counts: ReturnType<GraphRepository["counts"]>,
  storage: ReturnType<GraphRepository["storageDiagnostics"]>,
  freshness?: StatusFreshness
): string {
  const wal = storage.database.walCheckpoint.available
    ? `WAL pages: ${storage.database.walCheckpoint.log}, checkpointed: ${storage.database.walCheckpoint.checkpointed}`
    : `WAL status unavailable: ${storage.database.walCheckpoint.reason}`;
  const lines = [
    formatStatusCounts(counts),
    `Storage: ${formatBytes(storage.database.estimatedBytes)} (${storage.database.pageCount} pages, ${storage.database.freelistCount} freelist pages, ${storage.database.journalMode} journal).`,
    wal,
    `Objects: ${storage.objects.entries.length} tracked${storage.objects.dbstatAvailable ? " with dbstat sizes" : " without dbstat sizes"}.`,
    `Top path groups: ${storage.pathGroups.slice(0, 5).map((item) => `${item.group}=${formatBytes(item.contentBytes)}`).join(", ") || "none"}.`,
    `Edge kinds: ${storage.edgeKinds.map((item) => `${item.kind}=${item.edges}`).join(", ") || "none"}.`,
    `Vectors: ${storage.vectors.total}.`
  ];
  if (freshness) {
    lines.push(formatFreshness(freshness));
  }
  return lines.join("\n");
}

function formatStatusWithFreshness(counts: ReturnType<GraphRepository["counts"]>, freshness: StatusFreshness): string {
  return [formatStatusCounts(counts), formatFreshness(freshness)].join("\n");
}

function formatFreshness(freshness: StatusFreshness): string {
  return [
    `Freshness: ${freshness.state} - ${freshness.recommendation}`,
    freshness.lastIndexedAt ? `Last indexed: ${freshness.lastIndexedAt}` : "Last indexed: unavailable",
    freshness.issues?.length ? `Stale issues: ${freshness.issues.slice(0, 5).map((issue) => `${issue.path}:${issue.reason}`).join(", ")}` : "Stale issues: none"
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
    `Query mode: ${explanation.queryMode}`,
    `FTS query: ${explanation.ftsQuery || "none"}`,
    `Entity candidates: ${explanation.entityCandidates.join(", ") || "none"}`,
    `Semantic requested: ${explanation.semanticEnabled}`,
    `Semantic active: ${explanation.semanticActive}`,
    `Ranking: ${explanation.ranking.fusion} (channels: ${explanation.ranking.channels.join(", ") || "none"}, reranker: ${explanation.ranking.optionalReranker})`,
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
    `Packing: ${context.debug.packingStrategy}, items: ${context.debug.packedItems}, unique documents: ${context.debug.packedUniqueDocuments}, diversity: ${context.debug.packingDiversityRatio.toFixed(2)}`,
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
    `Average context diversity: ${formatMetric(report.summary.averageContextDiversity)}`,
    `Ranking: ${report.ranking.searchFusion}, query mode: ${report.ranking.queryMode}, packing: ${report.ranking.contextPackingStrategy}, reranker: ${report.ranking.optionalReranker}`,
    `Average latency: ${report.summary.averageLatencyMs.toFixed(1)} ms`,
    "",
    ...report.cases.map((result) => {
      const status = result.passed ? "pass" : "fail";
      return [
        `${result.id}: ${status}`,
        `  query: ${result.query}`,
        `  topKDocumentRecall=${formatMetric(result.metrics.topKDocumentRecall)}, expectedSectionRecall=${formatMetric(result.metrics.expectedSectionRecall)}, contextPrecision=${formatMetric(result.metrics.contextPrecision)}, contextDiversity=${formatMetric(result.metrics.contextDiversity)}`,
        `  traceSuccess=${result.metrics.traceSuccess ?? "n/a"}, returnedChars=${result.metrics.returnedChars}, budgetFit=${result.metrics.budgetFit}`
      ].join("\n");
    })
  ];
  return lines.join("\n");
}

function formatSemanticStatus(projectRoot: string, report: SemanticStatusReport): string {
  return [
    "MDGraph semantic status",
    `Project: ${projectRoot}`,
    `State: ${report.state}`,
    `Configured provider: ${report.provider}/${report.model} (${report.dimensions} dimensions, enabled: ${report.enabled})`,
    `Provider supported: ${report.providerSupported}`,
    `Indexed: ${report.indexed}`,
    `Vectors: ${report.vectors}/${report.chunks} chunks`,
    `Vector storage: ${report.vectorStorageFormat}`,
    `Indexed providers: ${report.indexedProviders.map((provider) => `${provider.provider}/${provider.model}/${provider.dimensions}=${provider.vectors}`).join(", ") || "none"}`,
    `Guidance: ${report.guidance.join(" ") || "none"}`
  ].join("\n");
}

function formatBundleCreate(result: Awaited<ReturnType<typeof createGraphBundle>>): string {
  return [
    "Created MDGraph bundle",
    `Directory: ${result.bundleDir}`,
    `Manifest: ${result.manifestPath}`,
    `Schema: v${result.manifest.schemaVersion}`,
    `Documents: ${result.manifest.counts.documents}`,
    `Source hash: ${result.manifest.sourceHash}`
  ].join("\n");
}

function formatBundleVerify(result: ReturnType<typeof verifyGraphBundle>): string {
  const lines = [
    "MDGraph bundle verification",
    `Directory: ${result.bundleDir}`,
    `Valid: ${result.valid}`,
    `Freshness: ${result.freshness.state} (${result.freshness.reason})`
  ];
  if (result.manifest) {
    lines.push(
      `Schema: v${result.manifest.schemaVersion ?? "unknown"}`,
      `Documents: ${result.manifest.counts?.documents ?? "unknown"}`,
      `Source hash: ${result.manifest.sourceHash ?? "unknown"}`
    );
  }
  if (result.errors.length) {
    lines.push("Errors:", ...result.errors.map((error) => `- ${error}`));
  }
  return lines.join("\n");
}

function formatSourceBridgeReport(report: SourceBridgeReport): string {
  const lines = [
    "MDGraph source bridge",
    `Provider: ${report.provider}`,
    `Status: ${report.status}`,
    `Source refs: ${report.sourceRefs}`,
    `Matched: ${report.matched.length}`,
    `Unmatched: ${report.unmatched.length}`
  ];
  if (report.reason) {
    lines.push(`Reason: ${report.reason}`);
  }
  if (report.matched.length) {
    lines.push("Matches:", ...report.matched.map((match) => `- ${match.sourceRef} -> ${match.artifactPath}${match.symbols.length ? ` (${match.symbols.map((symbol) => symbol.name).join(", ")})` : ""}`));
  }
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

function parseSearchQueryMode(value: string): SearchQueryMode {
  if (value === "auto" || value === "keyword" || value === "semantic") {
    return value;
  }
  throw new Error(`Expected query mode to be one of auto, keyword, or semantic; got ${value}`);
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
