import fs from "node:fs";
import path from "node:path";
import { MCP_LIMITS } from "../config/limits.js";
import { databasePath, loadConfig } from "../config/load-config.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type NodeRecord, type NodeResolution, type StatusCounts } from "../db/repositories.js";
import { buildContext, type ContextAutoMode, type ContextResult } from "../query/context-builder.js";
import { searchGraph } from "../query/search.js";
import { traceNodes, type TraceResult } from "../query/trace.js";
import { scanMarkdownFilesSync } from "../scanner/file-scanner.js";
import type { MDGraphConfig, SearchResult } from "../types.js";
import { isPathInsideOrEqual } from "../utils/path-safety.js";
import { normalizePath } from "../utils/text.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export class McpInputError extends Error {
  name = "McpInputError";
}

export const tools: McpToolDefinition[] = [
  {
    name: "mdgraph_search",
    description: "Search indexed Markdown documents, sections, and entities. Use before file reads for quick keyword, entity, path, command, config key, API route, or error-code lookup.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query, keyword, or entity name." },
        limit: { type: "number", description: "Maximum result count." },
        projectPath: { type: "string", description: "Optional project root inside the served root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_context",
    description: "Build an explainable task-start documentation brief for a cross-document question. Use before reading multiple Markdown docs manually.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Question or topic to gather document context for." },
        knownFiles: {
          type: "array",
          items: { type: "string" },
          description: "Optional known project-relative document or source paths to seed the task-start brief."
        },
        maxChars: { type: "number", description: "Optional character budget for the returned context package." },
        projectPath: { type: "string", description: "Optional project root inside the served root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_node",
    description: "Show details for a known document, section anchor, entity, source reference, chunk, or graph id after search/context narrows the target.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Document title/path, entity name, source path, or graph node id." },
        projectPath: { type: "string", description: "Optional project root inside the served root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_trace",
    description: "Trace an explainable relationship path between two indexed documents, entities, or source references.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["from", "to"],
      properties: {
        from: { type: "string", description: "Start document, entity, source path, or node id." },
        to: { type: "string", description: "End document, entity, source path, or node id." },
        depth: { type: "number", description: "Maximum graph depth. Defaults to 6." },
        projectPath: { type: "string", description: "Optional project root inside the served root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_status",
    description: "Show whether the MDGraph index is available, plus graph counts and database path. Use first when index availability is unclear.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectPath: { type: "string", description: "Optional project root inside the served root. Defaults to server cwd." }
      }
    }
  }
];

export class ToolHandler {
  private readonly defaultProjectRoot: string;
  private readonly boundProjectRoot: string;

  constructor(defaultProjectRoot = process.cwd(), boundProjectRoot = defaultProjectRoot) {
    this.boundProjectRoot = validatedProjectRoot(path.resolve(boundProjectRoot));
    this.defaultProjectRoot = validatedProjectRoot(path.resolve(defaultProjectRoot));
    if (!isPathInsideOrEqual(this.boundProjectRoot, this.defaultProjectRoot)) {
      throw new McpInputError(`Default project root must stay inside served root: ${this.boundProjectRoot}`);
    }
  }

  getTools(): McpToolDefinition[] {
    return tools;
  }

  execute(name: string, args: Record<string, unknown> = {}): McpToolResult {
    const projectRoot = resolveProjectRoot(args.projectPath, this.defaultProjectRoot, this.boundProjectRoot);

    if (name === "mdgraph_status") {
      if (!hasIndex(projectRoot)) {
        return textResult(unindexedMessage(projectRoot), { projectRoot, indexed: false });
      }
      return this.withRepository(projectRoot, (repository) => {
        const config = loadConfig(projectRoot);
        const counts = repository.counts();
        const freshness = statusFreshness(projectRoot, config, repository);
        return textResult(formatStatus(projectRoot, counts, freshness), { projectRoot, indexed: true, counts, freshness });
      });
    }

    if (!hasIndex(projectRoot)) {
      return textResult(unindexedMessage(projectRoot), { projectRoot, indexed: false });
    }

    switch (name) {
      case "mdgraph_search":
        return this.withRepository(projectRoot, (repository) => {
          const config = loadConfig(projectRoot);
          const query = requiredString(args.query, "query");
          const counts = repository.counts();
          const hasManualLimit = args.limit !== undefined && args.limit !== null;
          const autoMode = agentSearchMode(config, counts, query);
          const limit = hasManualLimit ? optionalBoundedPositiveInteger(args.limit, config.search.defaultLimit, "limit", MCP_LIMITS.searchLimit) : autoMode.limit;
          const results = searchGraph(repository, config, query, limit);
          const mode = hasManualLimit ? { name: "manual" as const, limit, reason: "explicit limit argument" } : autoMode;
          return textResult(formatSearch(results), { projectRoot, query, mode, results });
        });
      case "mdgraph_context":
        return this.withRepository(projectRoot, (repository) => {
          const config = loadConfig(projectRoot);
          const query = requiredString(args.query, "query");
          const knownFiles = optionalStringArray(args.knownFiles, "knownFiles");
          const hasManualMaxChars = args.maxChars !== undefined && args.maxChars !== null;
          const requestedMaxChars = optionalBoundedPositiveInteger(args.maxChars, config.search.maxContextChars, "maxChars", MCP_LIMITS.contextMaxChars);
          const mode = agentContextMode(config, repository.counts(), query, knownFiles, hasManualMaxChars ? requestedMaxChars : undefined);
          const context = buildContext(repository, config, query, {
            knownFiles,
            maxChars: mode.maxChars,
            searchLimit: mode.searchLimit,
            maxDepth: mode.maxDepth,
            mode
          });
          return textResult(formatContext(context), { projectRoot, context });
        });
      case "mdgraph_node":
        return this.withRepository(projectRoot, (repository) => {
          const query = requiredString(args.query, "query");
          const resolution = repository.resolveNodeDetailed(query);
          if (resolution.status === "not_found") {
            return textResult(`Node not found: ${query}`, { projectRoot, query, error: resolution.error, node: null });
          }
          if (resolution.status === "ambiguous") {
            return textResult(formatAmbiguousNodeQuery(resolution), { projectRoot, query, error: resolution.error, candidates: resolution.candidates, node: null });
          }
          return textResult(formatNode(resolution.node, repository), { projectRoot, node: resolution.node });
        });
      case "mdgraph_trace":
        return this.withRepository(projectRoot, (repository) => {
          const from = requiredString(args.from, "from");
          const to = requiredString(args.to, "to");
          const depth = optionalBoundedPositiveInteger(args.depth, 6, "depth", MCP_LIMITS.traceDepth);
          const trace = traceNodes(repository, from, to, depth);
          return textResult(formatTrace(trace), { projectRoot, trace });
        });
      default:
        return { ...textResult(`Unknown MDGraph tool: ${name}`, { name }), isError: true };
    }
  }

  private withRepository(projectRoot: string, fn: (repository: GraphRepository) => McpToolResult): McpToolResult {
    const repository = new GraphRepository(openExistingDatabase(projectRoot));
    try {
      return fn(repository);
    } finally {
      repository.close();
    }
  }
}

export function hasIndex(projectRoot: string): boolean {
  return fs.existsSync(databasePath(projectRoot));
}

function textResult(text: string, structuredContent?: unknown): McpToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent
  };
}

interface StatusFreshness {
  state: "fresh" | "stale" | "unknown";
  lastIndexedAt?: string;
  recommendation: string;
  checkedAt?: string;
  issues?: Array<{ path: string; reason: "added" | "deleted" | "modified" }>;
}

interface AgentSearchMode {
  name: "auto";
  limit: number;
  reason: string;
}

function formatStatus(projectRoot: string, counts: StatusCounts, freshness: StatusFreshness): string {
  const database = databasePath(projectRoot);
  return [
    "MDGraph index status: active",
    `Project: ${projectRoot}`,
    `Database: ${database}`,
    `Freshness: ${freshness.state} - ${freshness.recommendation}`,
    freshness.lastIndexedAt ? `Last indexed: ${freshness.lastIndexedAt}` : "Last indexed: unavailable",
    freshness.issues?.length ? `Stale issues: ${freshness.issues.slice(0, 5).map((issue) => `${issue.path}:${issue.reason}`).join(", ")}` : "Stale issues: none",
    `Documents: ${counts.documents}`,
    `Sections: ${counts.sections}`,
    `Entities: ${counts.entities}`,
    `Source refs: ${counts.sourceRefs}`,
    `Edges: ${counts.edges}`,
    `Chunks: ${counts.chunks}`,
    `Vectors: ${counts.vectors}`
  ].join("\n");
}

function statusFreshness(projectRoot: string, config: MDGraphConfig, repository: GraphRepository): StatusFreshness {
  const lastIndexedAt = repository.latestIndexedAt();
  const checkedAt = new Date().toISOString();
  if (!lastIndexedAt) {
    return {
      state: "unknown",
      checkedAt,
      recommendation: "no indexed timestamp is available; run `mdgraph index` before relying on the graph"
    };
  }

  try {
    const indexedAtMs = Date.parse(lastIndexedAt);
    const scanned = scanMarkdownFilesSync(projectRoot, config);
    const indexed = repository.documentHashes();
    const scannedByPath = new Map(scanned.map((filePath) => [normalizePath(path.relative(projectRoot, filePath)), filePath]));
    const issues: NonNullable<StatusFreshness["issues"]> = [];

    for (const [relativePath, absolutePath] of scannedByPath) {
      if (!indexed.has(relativePath)) {
        issues.push({ path: relativePath, reason: "added" });
        continue;
      }
      if (Number.isFinite(indexedAtMs) && fs.statSync(absolutePath).mtimeMs > indexedAtMs + 1) {
        issues.push({ path: relativePath, reason: "modified" });
      }
    }

    for (const documentPath of indexed.keys()) {
      if (!scannedByPath.has(documentPath)) {
        issues.push({ path: documentPath, reason: "deleted" });
      }
    }

    const sortedIssues = issues.sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
    return {
      state: sortedIssues.length ? "stale" : "fresh",
      lastIndexedAt,
      checkedAt,
      recommendation: sortedIssues.length
        ? "Markdown files changed since indexing; run `mdgraph index` before relying on results"
        : "indexed Markdown files match the lightweight status freshness check",
      issues: sortedIssues.length ? sortedIssues.slice(0, 20) : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "unknown",
      lastIndexedAt,
      checkedAt,
      recommendation: `freshness check failed: ${message}; run \`mdgraph doctor --json\` or \`mdgraph index\``
    };
  }
}

function agentSearchMode(config: MDGraphConfig, counts: StatusCounts, query: string): AgentSearchMode {
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const reasons = ["config default"];
  let limit = config.search.defaultLimit;
  if (wordCount > 6 || query.length > 80) {
    limit += Math.ceil(config.search.defaultLimit / 2);
    reasons.push("multi-term task query");
  }
  if (counts.documents >= 1000) {
    limit += config.search.defaultLimit;
    reasons.push("large index");
  } else if (counts.documents >= 100) {
    limit += Math.ceil(config.search.defaultLimit / 2);
    reasons.push("medium index");
  }

  return {
    name: "auto",
    limit: Math.min(24, Math.max(4, limit)),
    reason: reasons.join("; ")
  };
}

function agentContextMode(
  config: MDGraphConfig,
  counts: StatusCounts,
  query: string,
  knownFiles: string[],
  requestedMaxChars: number | undefined
): ContextAutoMode {
  const searchMode = agentSearchMode(config, counts, query);
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const needsMoreDepth = knownFiles.length > 0 || wordCount > 6 || counts.documents >= 100;
  const maxDepth = Math.min(4, config.search.maxDepth + (needsMoreDepth ? 1 : 0));
  const maxChars = requestedMaxChars ?? Math.min(config.search.maxContextChars, needsMoreDepth ? config.search.maxContextChars : 16_000);
  return {
    name: "auto",
    searchLimit: searchMode.limit,
    maxDepth,
    maxChars,
    reason: [searchMode.reason, requestedMaxChars ? "explicit character budget" : "auto character budget"].join("; ")
  };
}

function formatSearch(results: SearchResult[]): string {
  if (!results.length) {
    return "No MDGraph search results.";
  }
  return results.map((result, index) => {
    const location = result.section
      ? `${result.document.path}#${result.section.anchor}:${result.section.startLine}`
      : result.document.path;
    const entities = result.matchedEntities.length
      ? `\nMatched entities: ${result.matchedEntities.map((entity) => `${entity.name} (${entity.kind})`).join(", ")}`
      : "";
    return `${index + 1}. ${location}\nReason: ${result.reason}${entities}\n${trimBlock(result.content, 1200)}`;
  }).join("\n\n");
}

function formatContext(context: ContextResult): string {
  if (!context.items.length) {
    return "No MDGraph context found.";
  }
  const header = `Context for: ${context.query}\nBudget: ${context.usedChars}/${context.maxChars} chars`;
  const items = context.items.map((item, index) => {
    const line = item.lines ? `:${item.lines.start}` : "";
    const heading = item.heading ? `# ${item.heading}` : `# ${item.title}`;
    const entities = item.matchedEntities.length ? `\nMatched entities: ${item.matchedEntities.join(", ")}` : "";
    const sourceRefs = item.sourceRefs?.length ? `\nSource refs: ${item.sourceRefs.map((sourceRef) => `${sourceRef.path} (${sourceRef.edgeKind}/${sourceRef.provenance}, confidence ${sourceRef.confidence})`).join(", ")}` : "";
    const riskNotes = item.riskNotes?.length ? `\nRisk notes: ${item.riskNotes.join("; ")}` : "";
    return `## ${index + 1}. ${item.path}${line}\nReason: ${item.reason}${entities}${sourceRefs}${riskNotes}\n${heading}\n${item.content}`;
  });
  const hints = [
    context.mode ? `Mode: ${context.mode.name} (searchLimit ${context.mode.searchLimit}, maxDepth ${context.mode.maxDepth}; ${context.mode.reason})` : "",
    context.knownFiles?.length ? `Known files: ${context.knownFiles.join(", ")}` : "",
    context.suggestedNextQueries?.length ? `Suggested next queries:\n${context.suggestedNextQueries.map((query) => `- ${query}`).join("\n")}` : ""
  ].filter(Boolean);
  return [header, ...hints, ...items].join("\n\n");
}

function formatNode(node: NodeRecord, repository: GraphRepository): string {
  const edges = repository.edgesForNode(node.id).slice(0, 12);
  const related = edges.map((edge) => {
    const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
    const other = repository.getNode(otherId);
    return `- ${edge.kind} ${edge.fromId === node.id ? "->" : "<-"} ${other?.label ?? otherId} (${edge.provenance}, confidence ${edge.confidence})`;
  });
  return [
    `${node.kind}: ${node.label}`,
    JSON.stringify(node.data, null, 2),
    related.length ? `Related edges:\n${related.join("\n")}` : "Related edges: none"
  ].join("\n\n");
}

function formatAmbiguousNodeQuery(resolution: Extract<NodeResolution, { status: "ambiguous" }>): string {
  const candidates = resolution.candidates
    .map((candidate) => `- ${candidate.documentPath}#${candidate.anchor}:${candidate.line} (${candidate.heading})`)
    .join("\n");
  return `Ambiguous section query: ${resolution.query}\n${candidates}`;
}

function formatTrace(trace: TraceResult): string {
  if (!trace.found) {
    return trace.message ?? "No MDGraph trace path found.";
  }
  if (!trace.steps.length) {
    return `Trace found: ${trace.from} is ${trace.to}`;
  }
  const steps = trace.steps.map((step, index) => (
    `${index + 1}. ${formatTraceStep(step)}`
  ));
  return [`Trace: ${trace.from} -> ${trace.to}`, ...steps].join("\n");
}

function formatTraceStep(step: TraceResult["steps"][number]): string {
  const edge = `${step.edgeKind} (${step.provenance}, confidence ${step.confidence})`;
  return step.traversalDirection === "forward"
    ? `${step.fromLabel} --${edge}--> ${step.toLabel}`
    : `${step.fromLabel} <--${edge}-- ${step.toLabel}`;
}

function resolveProjectRoot(rawProjectPath: unknown, fallback: string, boundProjectRoot: string): string {
  if (rawProjectPath === undefined || rawProjectPath === null || rawProjectPath === "") {
    return validatedBoundProjectRoot(path.resolve(fallback), boundProjectRoot);
  }
  if (typeof rawProjectPath !== "string") {
    throw new McpInputError("projectPath must be a string when provided");
  }
  return validatedBoundProjectRoot(path.resolve(rawProjectPath), boundProjectRoot);
}

function validatedProjectRoot(projectRoot: string): string {
  if (!fs.existsSync(projectRoot)) {
    throw new McpInputError(`Project root does not exist: ${projectRoot}`);
  }
  const stat = fs.statSync(projectRoot);
  if (!stat.isDirectory()) {
    throw new McpInputError(`Project root is not a directory: ${projectRoot}`);
  }
  return projectRoot;
}

function validatedBoundProjectRoot(projectRoot: string, boundProjectRoot: string): string {
  const resolved = validatedProjectRoot(projectRoot);
  if (!isPathInsideOrEqual(boundProjectRoot, resolved)) {
    throw new McpInputError(`projectPath must stay inside served project root: ${boundProjectRoot}`);
  }
  return resolved;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new McpInputError(`Missing required string argument: ${field}`);
  }
  if (value.length > 10_000) {
    throw new McpInputError(`Argument too long: ${field}`);
  }
  return value.trim();
}

function optionalPositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new McpInputError(`Expected positive integer, got ${String(value)}`);
  }
  return parsed;
}

function optionalBoundedPositiveInteger(value: unknown, fallback: number, field: string, max: number): number {
  const parsed = optionalPositiveInteger(value, fallback);
  if (parsed > max) {
    throw new McpInputError(`${field} must be at most ${max}`);
  }
  return parsed;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new McpInputError(`${field} must be an array of strings when provided`);
  }
  if (value.length > 20) {
    throw new McpInputError(`${field} must include at most 20 entries`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new McpInputError(`${field} must contain only strings`);
    }
    const trimmed = item.trim();
    if (trimmed.length > 1_000) {
      throw new McpInputError(`${field} entry is too long`);
    }
    if (trimmed) {
      result.push(trimmed);
    }
  }
  return [...new Set(result)];
}

function trimBlock(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars).trimEnd()}\n...`;
}

function unindexedMessage(projectRoot: string): string {
  return [
    "MDGraph index status: inactive",
    `Project: ${projectRoot}`,
    "No .mdgraph/graph.db index was found.",
    "Use normal file tools for this session, or run `mdgraph index` when the user asks to create/update the index."
  ].join("\n");
}
