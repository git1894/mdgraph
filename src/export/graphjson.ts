import { canonicalJson, hashCanonical, sourceSnapshot } from "../bundle/bundle.js";
import { loadConfig } from "../config/load-config.js";
import type { GraphRepository, StatusCounts } from "../db/repositories.js";
import type { EdgeKind, Provenance } from "../types.js";
import { readBoundedJsonFile } from "../utils/bounded-json.js";
import { packageVersion } from "../version.js";

export const GRAPHJSON_FORMAT = "mdgraph-graphjson" as const;
export const GRAPHJSON_FORMAT_VERSION = 1 as const;

export type GraphJsonNode =
  | {
      id: string;
      kind: "document";
      label: string;
      path: string;
      documentType: string;
      status: string;
      trustTier: string;
    }
  | {
      id: string;
      kind: "section";
      label: string;
      documentId: string;
      anchor: string;
      level: number;
      lines: { start: number; end: number };
    }
  | {
      id: string;
      kind: "entity";
      label: string;
      entityKind: string;
      normalizedName: string;
      namespace?: string;
    }
  | {
      id: string;
      kind: "source_ref";
      label: string;
      path: string;
      normalizedPath: string;
    };

export interface GraphJsonEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: EdgeKind;
  weight: number;
  confidence: number;
  provenance: Provenance;
}

export interface GraphJsonExport {
  format: typeof GRAPHJSON_FORMAT;
  formatVersion: typeof GRAPHJSON_FORMAT_VERSION;
  schemaVersion: number;
  mdgraphVersion: string;
  exportProfile: "structural";
  graphHash: string;
  sourceHash: string;
  counts: StatusCounts;
  exportedCounts: {
    documents: number;
    sections: number;
    entities: number;
    sourceRefs: number;
    nodes: number;
    edges: number;
  };
  nodes: GraphJsonNode[];
  edges: GraphJsonEdge[];
}

export interface GraphJsonVerificationError {
  code: string;
  message: string;
  evidence?: string;
  remediation: string;
}

export interface GraphJsonVerificationResult {
  valid: boolean;
  errors: GraphJsonVerificationError[];
  warnings: string[];
  format?: string;
  formatVersion?: number;
  schemaVersion?: number;
  graphHash?: string;
  counts?: GraphJsonExport["counts"];
  exportedCounts?: GraphJsonExport["exportedCounts"];
}

const NODE_KINDS = new Set(["document", "section", "entity", "source_ref"]);
const EDGE_KINDS = new Set([
  "CONTAINS",
  "DEFINES",
  "REFERENCES",
  "DEPENDS_ON",
  "LINKS_TO",
  "IMPLEMENTS",
  "REFERENCES_SOURCE",
  "SUPERSEDES",
  "DEPRECATED_BY",
  "SAME_AS",
  "RELATED_TO",
  "CONTRADICTS"
]);

export function buildGraphJsonExport(projectRoot: string, repository: GraphRepository): GraphJsonExport {
  const documents = repository.allDocuments();
  const sections = repository.allSections();
  const entities = repository.allEntities();
  const sourceRefs = repository.allSourceRefs();
  const nodeIds = new Set<string>();
  const documentNodes: Array<Extract<GraphJsonNode, { kind: "document" }>> = documents
    .map((document) => ({
      id: document.id,
      kind: "document" as const,
      label: document.title,
      path: document.path,
      documentType: document.type,
      status: document.status,
      trustTier: document.trustTier
    }))
    .sort(compareDocumentNodes);
  const pathByDocumentId = documentPathById(documents);
  const sectionNodes: Array<Extract<GraphJsonNode, { kind: "section" }>> = sections
    .map((section) => ({
      id: section.id,
      kind: "section" as const,
      label: section.heading,
      documentId: section.documentId,
      anchor: section.anchor,
      level: section.level,
      lines: { start: section.startLine, end: section.endLine }
    }))
    .sort((left, right) => compareSectionNodes(left, right, pathByDocumentId));
  const entityNodes: Array<Extract<GraphJsonNode, { kind: "entity" }>> = entities
    .map((entity) => ({
      id: entity.id,
      kind: "entity" as const,
      label: entity.name,
      entityKind: entity.kind,
      normalizedName: entity.normalizedName,
      namespace: entity.namespace
    }))
    .sort(compareEntityNodes);
  const sourceRefNodes: Array<Extract<GraphJsonNode, { kind: "source_ref" }>> = sourceRefs
    .map((sourceRef) => ({
      id: sourceRef.id,
      kind: "source_ref" as const,
      label: sourceRef.path,
      path: sourceRef.path,
      normalizedPath: sourceRef.normalizedPath
    }))
    .sort(compareSourceRefNodes);
  const nodes: GraphJsonNode[] = [...documentNodes, ...sectionNodes, ...entityNodes, ...sourceRefNodes];
  for (const node of nodes) {
    nodeIds.add(node.id);
  }

  const edges = repository.allEdges()
    .filter((edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId))
    .map((edge): GraphJsonEdge => ({
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      kind: edge.kind,
      weight: edge.weight,
      confidence: edge.confidence,
      provenance: edge.provenance
    }))
    .sort(compareEdges);
  const counts = repository.counts();
  const schema = repository.schemaMetadata();
  const source = sourceSnapshot(loadConfig(projectRoot), documents.map((document) => ({ path: document.path, hash: document.hash })));
  const withoutHash = {
    format: GRAPHJSON_FORMAT,
    formatVersion: GRAPHJSON_FORMAT_VERSION,
    schemaVersion: schema.schemaVersion,
    mdgraphVersion: packageVersion(),
    exportProfile: "structural" as const,
    sourceHash: source.sourceHash,
    counts,
    exportedCounts: {
      documents: documents.length,
      sections: sections.length,
      entities: entities.length,
      sourceRefs: sourceRefs.length,
      nodes: nodes.length,
      edges: edges.length
    },
    nodes,
    edges
  };
  return {
    ...withoutHash,
    graphHash: hashCanonical(withoutHash)
  };
}

export function readGraphJsonFile(filePath: string): unknown {
  return readBoundedJsonFile(filePath, "GraphJSON file");
}

export function verifyGraphJsonExport(value: unknown): GraphJsonVerificationResult {
  const errors: GraphJsonVerificationError[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: [verificationError("graphjson.not_object", "GraphJSON input must be a JSON object.", undefined, "Export with `mdgraph export graphjson --json`.")],
      warnings
    };
  }

  const format = typeof value.format === "string" ? value.format : undefined;
  const formatVersion = typeof value.formatVersion === "number" ? value.formatVersion : undefined;
  const schemaVersion = typeof value.schemaVersion === "number" ? value.schemaVersion : undefined;
  const graphHash = typeof value.graphHash === "string" ? value.graphHash : undefined;

  if (value.format !== GRAPHJSON_FORMAT) {
    errors.push(verificationError("graphjson.format", "GraphJSON format must be mdgraph-graphjson.", String(value.format), "Use a MDGraph GraphJSON export."));
  }
  if (value.formatVersion !== GRAPHJSON_FORMAT_VERSION) {
    errors.push(verificationError("graphjson.format_version", `Unsupported GraphJSON formatVersion: ${String(value.formatVersion)}.`, String(value.formatVersion), "Use formatVersion 1 or upgrade this MDGraph binary."));
  }
  if (typeof value.schemaVersion !== "number") {
    errors.push(verificationError("graphjson.schema_version", "GraphJSON schemaVersion must be a number.", String(value.schemaVersion), "Re-export from an indexed MDGraph workspace."));
  }
  if (!isStatusCounts(value.counts)) {
    errors.push(verificationError("graphjson.counts", "GraphJSON counts must include documents, sections, entities, sourceRefs, edges, chunks, and vectors.", undefined, "Re-export with the current MDGraph CLI."));
  }
  if (!isExportedCounts(value.exportedCounts)) {
    errors.push(verificationError("graphjson.exported_counts", "GraphJSON exportedCounts must include documents, sections, entities, sourceRefs, nodes, and edges.", undefined, "Re-export with the current MDGraph CLI."));
  }
  if (!Array.isArray(value.nodes)) {
    errors.push(verificationError("graphjson.nodes", "GraphJSON nodes must be an array.", undefined, "Re-export with the current MDGraph CLI."));
  }
  if (!Array.isArray(value.edges)) {
    errors.push(verificationError("graphjson.edges", "GraphJSON edges must be an array.", undefined, "Re-export with the current MDGraph CLI."));
  }

  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  const nodeIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node) || typeof node.id !== "string" || typeof node.kind !== "string") {
      errors.push(verificationError("graphjson.node_shape", "GraphJSON node must include string id and kind.", `nodes[${index}]`, "Re-export with the current MDGraph CLI."));
      continue;
    }
    if (!NODE_KINDS.has(node.kind)) {
      errors.push(verificationError("graphjson.node_kind", `Unsupported GraphJSON node kind: ${node.kind}.`, node.id, "Use a supported node kind or upgrade this MDGraph binary."));
    }
    if (nodeIds.has(node.id)) {
      errors.push(verificationError("graphjson.node_duplicate", `Duplicate GraphJSON node id: ${node.id}.`, node.id, "Ensure every exported node id is unique."));
    }
    nodeIds.add(node.id);
  }

  for (const [index, edge] of edges.entries()) {
    if (!isRecord(edge) || typeof edge.id !== "string" || typeof edge.fromId !== "string" || typeof edge.toId !== "string" || typeof edge.kind !== "string") {
      errors.push(verificationError("graphjson.edge_shape", "GraphJSON edge must include string id, fromId, toId, and kind.", `edges[${index}]`, "Re-export with the current MDGraph CLI."));
      continue;
    }
    if (!EDGE_KINDS.has(edge.kind)) {
      errors.push(verificationError("graphjson.edge_kind", `Unsupported GraphJSON edge kind: ${edge.kind}.`, edge.id, "Use a supported edge kind or upgrade this MDGraph binary."));
    }
    if (!nodeIds.has(edge.fromId)) {
      errors.push(verificationError("graphjson.edge_endpoint", `Edge ${edge.id} references missing fromId ${edge.fromId}.`, edge.id, "Verify the export is complete and not manually edited."));
    }
    if (!nodeIds.has(edge.toId)) {
      errors.push(verificationError("graphjson.edge_endpoint", `Edge ${edge.id} references missing toId ${edge.toId}.`, edge.id, "Verify the export is complete and not manually edited."));
    }
  }

  if (isExportedCounts(value.exportedCounts)) {
    compareExportedCounts(value.exportedCounts, nodes, edges, errors);
  }
  if (isRecord(value.counts) && typeof value.counts.edges === "number" && typeof value.exportedCounts === "object" && isRecord(value.exportedCounts) && typeof value.exportedCounts.edges === "number" && value.exportedCounts.edges < value.counts.edges) {
    warnings.push("Structural GraphJSON excludes chunk endpoint edges; counts.edges may be larger than exportedCounts.edges.");
  }
  if (graphHash) {
    const recalculated = graphJsonHash(value);
    if (recalculated !== graphHash) {
      errors.push(verificationError("graphjson.graph_hash", "GraphJSON graphHash does not match the structural payload.", graphHash, "Re-export the graph or discard the modified file."));
    }
  } else {
    errors.push(verificationError("graphjson.graph_hash", "GraphJSON graphHash must be present.", undefined, "Re-export with the current MDGraph CLI."));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    format,
    formatVersion,
    schemaVersion,
    graphHash,
    counts: isStatusCounts(value.counts) ? value.counts : undefined,
    exportedCounts: isExportedCounts(value.exportedCounts) ? value.exportedCounts : undefined
  };
}

export function graphJsonHash(value: Record<string, unknown>): string {
  const { graphHash: _graphHash, ...withoutHash } = value;
  return hashCanonical(withoutHash);
}

export function formatGraphJsonVerification(result: GraphJsonVerificationResult): string {
  const lines = [
    "MDGraph GraphJSON verification",
    `Valid: ${result.valid}`,
    `Format: ${result.format ?? "unknown"} v${result.formatVersion ?? "unknown"}`,
    `Schema: ${result.schemaVersion ?? "unknown"}`,
    `Graph hash: ${result.graphHash ?? "missing"}`
  ];
  if (result.exportedCounts) {
    lines.push(`Exported: ${result.exportedCounts.nodes} nodes, ${result.exportedCounts.edges} edges.`);
  }
  if (result.warnings.length) {
    lines.push("Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }
  if (result.errors.length) {
    lines.push("Errors:", ...result.errors.map((error) => `- ${error.code}: ${error.message}`));
  }
  return lines.join("\n");
}

export function stableGraphJson(value: GraphJsonExport): string {
  return `${canonicalJson(value)}\n`;
}

function documentPathById(documents: Array<{ id: string; path: string }>): Map<string, string> {
  return new Map(documents.map((document) => [document.id, document.path]));
}

function compareDocumentNodes(left: Extract<GraphJsonNode, { kind: "document" }>, right: Extract<GraphJsonNode, { kind: "document" }>): number {
  return compareStrings(left.path, right.path) || compareStrings(left.id, right.id);
}

function compareSectionNodes(left: Extract<GraphJsonNode, { kind: "section" }>, right: Extract<GraphJsonNode, { kind: "section" }>, pathByDocumentId: Map<string, string>): number {
  return compareStrings(pathByDocumentId.get(left.documentId) ?? "", pathByDocumentId.get(right.documentId) ?? "")
    || left.lines.start - right.lines.start
    || compareStrings(left.id, right.id);
}

function compareEntityNodes(left: Extract<GraphJsonNode, { kind: "entity" }>, right: Extract<GraphJsonNode, { kind: "entity" }>): number {
  return compareStrings(left.entityKind, right.entityKind) || compareStrings(left.normalizedName, right.normalizedName) || compareStrings(left.id, right.id);
}

function compareSourceRefNodes(left: Extract<GraphJsonNode, { kind: "source_ref" }>, right: Extract<GraphJsonNode, { kind: "source_ref" }>): number {
  return compareStrings(left.normalizedPath, right.normalizedPath) || compareStrings(left.id, right.id);
}

function compareEdges(left: GraphJsonEdge, right: GraphJsonEdge): number {
  return compareStrings(left.fromId, right.fromId)
    || compareStrings(left.toId, right.toId)
    || compareStrings(left.kind, right.kind)
    || compareStrings(left.id, right.id);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareExportedCounts(expected: GraphJsonExport["exportedCounts"], nodes: unknown[], edges: unknown[], errors: GraphJsonVerificationError[]): void {
  const byKind = new Map<string, number>();
  for (const node of nodes) {
    if (isRecord(node) && typeof node.kind === "string") {
      byKind.set(node.kind, (byKind.get(node.kind) ?? 0) + 1);
    }
  }
  const actual = {
    documents: byKind.get("document") ?? 0,
    sections: byKind.get("section") ?? 0,
    entities: byKind.get("entity") ?? 0,
    sourceRefs: byKind.get("source_ref") ?? 0,
    nodes: nodes.length,
    edges: edges.length
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (expected[key] !== actual[key]) {
      errors.push(verificationError("graphjson.count_mismatch", `exportedCounts.${key} is ${expected[key]}, but export contains ${actual[key]}.`, key, "Re-export the graph or fix the counts."));
    }
  }
}

function verificationError(code: string, message: string, evidence: string | undefined, remediation: string): GraphJsonVerificationError {
  return { code, message, evidence, remediation };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStatusCounts(value: unknown): value is StatusCounts {
  if (!isRecord(value)) {
    return false;
  }
  return ["documents", "sections", "entities", "sourceRefs", "edges", "chunks", "vectors"].every((key) => typeof value[key] === "number");
}

function isExportedCounts(value: unknown): value is GraphJsonExport["exportedCounts"] {
  if (!isRecord(value)) {
    return false;
  }
  return ["documents", "sections", "entities", "sourceRefs", "nodes", "edges"].every((key) => typeof value[key] === "number");
}
