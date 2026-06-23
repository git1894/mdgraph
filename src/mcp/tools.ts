import fs from "node:fs";
import path from "node:path";
import { databasePath, loadConfig } from "../config/load-config.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type NodeRecord, type NodeResolution, type StatusCounts } from "../db/repositories.js";
import { buildContext, type ContextResult } from "../query/context-builder.js";
import { searchGraph } from "../query/search.js";
import { traceNodes, type TraceResult } from "../query/trace.js";
import type { SearchResult } from "../types.js";

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
    description: "Search indexed Markdown documents, sections, and entities. Use for quick keyword or entity lookup.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query, keyword, or entity name." },
        limit: { type: "number", description: "Maximum result count." },
        projectPath: { type: "string", description: "Optional project root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_context",
    description: "Build an explainable context package for a cross-document question. Use before reading multiple docs manually.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Question or topic to gather document context for." },
        projectPath: { type: "string", description: "Optional project root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_node",
    description: "Show details for a document, entity, source reference, section, or chunk by name, path, or id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Document title/path, entity name, source path, or graph node id." },
        projectPath: { type: "string", description: "Optional project root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_trace",
    description: "Trace an explainable path between two indexed documents, entities, or source references.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["from", "to"],
      properties: {
        from: { type: "string", description: "Start document, entity, source path, or node id." },
        to: { type: "string", description: "End document, entity, source path, or node id." },
        depth: { type: "number", description: "Maximum graph depth. Defaults to 6." },
        projectPath: { type: "string", description: "Optional project root. Defaults to server cwd." }
      }
    }
  },
  {
    name: "mdgraph_status",
    description: "Show MDGraph index status and graph counts for the workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectPath: { type: "string", description: "Optional project root. Defaults to server cwd." }
      }
    }
  }
];

export class ToolHandler {
  constructor(private readonly defaultProjectRoot = process.cwd()) {}

  getTools(): McpToolDefinition[] {
    return tools;
  }

  execute(name: string, args: Record<string, unknown> = {}): McpToolResult {
    const projectRoot = resolveProjectRoot(args.projectPath, this.defaultProjectRoot);

    if (name === "mdgraph_status") {
      if (!hasIndex(projectRoot)) {
        return textResult(unindexedMessage(projectRoot), { projectRoot, indexed: false });
      }
      return this.withRepository(projectRoot, (repository) => {
        const counts = repository.counts();
        return textResult(formatStatus(projectRoot, counts), { projectRoot, indexed: true, counts });
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
          const limit = optionalPositiveInteger(args.limit, config.search.defaultLimit);
          const results = searchGraph(repository, config, query, limit);
          return textResult(formatSearch(results), { projectRoot, query, results });
        });
      case "mdgraph_context":
        return this.withRepository(projectRoot, (repository) => {
          const config = loadConfig(projectRoot);
          const query = requiredString(args.query, "query");
          const context = buildContext(repository, config, query);
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
          const depth = optionalPositiveInteger(args.depth, 6);
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

function formatStatus(projectRoot: string, counts: StatusCounts): string {
  const database = databasePath(projectRoot);
  return [
    "MDGraph index status: active",
    `Project: ${projectRoot}`,
    `Database: ${database}`,
    `Documents: ${counts.documents}`,
    `Sections: ${counts.sections}`,
    `Entities: ${counts.entities}`,
    `Source refs: ${counts.sourceRefs}`,
    `Edges: ${counts.edges}`,
    `Chunks: ${counts.chunks}`,
    `Vectors: ${counts.vectors}`
  ].join("\n");
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
    return `## ${index + 1}. ${item.path}${line}\nReason: ${item.reason}${entities}\n${heading}\n${item.content}`;
  });
  return [header, ...items].join("\n\n");
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

function resolveProjectRoot(rawProjectPath: unknown, fallback: string): string {
  if (rawProjectPath === undefined || rawProjectPath === null || rawProjectPath === "") {
    return validatedProjectRoot(path.resolve(fallback));
  }
  if (typeof rawProjectPath !== "string") {
    throw new McpInputError("projectPath must be a string when provided");
  }
  return validatedProjectRoot(path.resolve(rawProjectPath));
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
