import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDoctor, type DoctorReport, type DoctorWarning } from "../analysis/doctor.js";
import { sourceSnapshot } from "../bundle/bundle.js";
import { configPath, loadConfig } from "../config/load-config.js";
import { openDatabase } from "../db/connection.js";
import { GraphRepository, type StatusCounts } from "../db/repositories.js";
import { indexProject } from "../indexer.js";
import type { GraphDocument, GraphEdge, GraphSection, SourceRef } from "../types.js";
import { normalizePath } from "../utils/text.js";

export interface GraphDiffReport {
  mode: "base_ref";
  base: {
    ref: string;
    revision: string;
    sourceHash?: string;
  };
  head: {
    sourceHash: string;
  };
  summary: {
    documentsAdded: number;
    documentsModified: number;
    documentsDeleted: number;
    documentsRenamed: number;
    sectionsChanged: number;
    sourceRefsChanged: number;
    edgesChanged: number;
    warningDelta: Record<string, number>;
  };
  documents: GraphDiffDocument[];
  impact: {
    changedSourceRefs: string[];
    affectedDocs: string[];
    prSummary: string[];
  };
}

export interface GraphDiffDocument {
  path: string;
  previousPath?: string;
  change: "added" | "modified" | "deleted" | "renamed";
  hashChanged: boolean;
  statusChanged?: boolean;
  sectionDelta?: number;
  sourceRefDelta?: number;
  warningCodes?: string[];
}

interface GraphSnapshot {
  sourceHash: string;
  counts: StatusCounts;
  documents: Map<string, GraphDocument>;
  sectionCounts: Map<string, number>;
  sourceRefCounts: Map<string, number>;
  sourceRefs: Set<string>;
  warningCounts: Record<string, number>;
  warningCodesByDocument: Map<string, Set<string>>;
}

export async function generateGraphDiff(projectRoot: string, options: { base: string }): Promise<GraphDiffReport> {
  const resolvedRoot = path.resolve(projectRoot);
  const baseRevision = resolveBaseRevision(resolvedRoot, options.base);
  const baseRoot = createBaseSnapshot(resolvedRoot, baseRevision);
  try {
    await indexProject(baseRoot, { full: true });
    const baseSnapshot = await graphSnapshot(baseRoot);
    const headSnapshot = await graphSnapshot(resolvedRoot);
    const documents = diffDocuments(baseSnapshot, headSnapshot, gitRenames(resolvedRoot, baseRevision));
    const warningDelta = countDelta(baseSnapshot.warningCounts, headSnapshot.warningCounts);
    const changedSourceRefs = setSymmetricDifference(baseSnapshot.sourceRefs, headSnapshot.sourceRefs);
    const affectedDocs = affectedDocumentPaths(documents, baseSnapshot, headSnapshot);
    const report: GraphDiffReport = {
      mode: "base_ref",
      base: {
        ref: options.base,
        revision: baseRevision,
        sourceHash: baseSnapshot.sourceHash
      },
      head: {
        sourceHash: headSnapshot.sourceHash
      },
      summary: {
        documentsAdded: documents.filter((document) => document.change === "added").length,
        documentsModified: documents.filter((document) => document.change === "modified").length,
        documentsDeleted: documents.filter((document) => document.change === "deleted").length,
        documentsRenamed: documents.filter((document) => document.change === "renamed").length,
        sectionsChanged: headSnapshot.counts.sections - baseSnapshot.counts.sections,
        sourceRefsChanged: headSnapshot.counts.sourceRefs - baseSnapshot.counts.sourceRefs,
        edgesChanged: headSnapshot.counts.edges - baseSnapshot.counts.edges,
        warningDelta
      },
      documents,
      impact: {
        changedSourceRefs,
        affectedDocs,
        prSummary: []
      }
    };
    report.impact.prSummary = prSummary(report);
    return report;
  } finally {
    fs.rmSync(baseRoot, { recursive: true, force: true });
  }
}

export function formatGraphDiff(report: GraphDiffReport): string {
  const lines = [
    "MDGraph diff",
    `Base: ${report.base.ref} (${report.base.revision})`,
    `Head source hash: ${report.head.sourceHash}`,
    `Documents: +${report.summary.documentsAdded}, ~${report.summary.documentsModified}, -${report.summary.documentsDeleted}, renamed ${report.summary.documentsRenamed}`,
    `Graph deltas: sections ${formatSigned(report.summary.sectionsChanged)}, source refs ${formatSigned(report.summary.sourceRefsChanged)}, edges ${formatSigned(report.summary.edgesChanged)}`
  ];
  const warningDelta = Object.entries(report.summary.warningDelta).map(([code, delta]) => `${code} ${formatSigned(delta)}`);
  lines.push(`Warning delta: ${warningDelta.join(", ") || "none"}`);
  if (report.impact.changedSourceRefs.length) {
    lines.push("Changed source refs:", ...report.impact.changedSourceRefs.map((sourceRef) => `- ${sourceRef}`));
  }
  if (report.documents.length) {
    lines.push("Changed documents:", ...report.documents.slice(0, 25).map(formatDiffDocument));
    if (report.documents.length > 25) {
      lines.push(`- ... ${report.documents.length - 25} more`);
    }
  }
  if (report.impact.prSummary.length) {
    lines.push("PR summary:", ...report.impact.prSummary.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

async function graphSnapshot(projectRoot: string): Promise<GraphSnapshot> {
  const config = loadConfig(projectRoot);
  const repository = new GraphRepository(openDatabase(projectRoot, { createIfMissing: false, applySchema: false }));
  try {
    const documents = repository.allDocuments();
    const sections = repository.allSections();
    const sourceRefs = repository.allSourceRefs();
    const edges = repository.allEdges();
    const source = sourceSnapshot(config, documents.map((document) => ({ path: document.path, hash: document.hash })));
    const doctor = await runDoctor(projectRoot, { applySchema: false });
    return {
      sourceHash: source.sourceHash,
      counts: repository.counts(),
      documents: new Map(documents.map((document) => [document.path, document])),
      sectionCounts: sectionCountsByDocument(documents, sections),
      sourceRefCounts: sourceRefCountsByDocument(documents, sourceRefs, edges),
      sourceRefs: new Set(sourceRefs.map((sourceRef) => sourceRef.path)),
      warningCounts: warningCounts(doctor),
      warningCodesByDocument: warningCodesByDocument(doctor.warnings)
    };
  } finally {
    repository.close();
  }
}

function diffDocuments(base: GraphSnapshot, head: GraphSnapshot, renames: Map<string, string>): GraphDiffDocument[] {
  const documents: GraphDiffDocument[] = [];
  const consumedBase = new Set<string>();
  const consumedHead = new Set<string>();

  for (const [previousPath, nextPath] of renames) {
    const previous = base.documents.get(previousPath);
    const next = head.documents.get(nextPath);
    if (!previous || !next) {
      continue;
    }
    consumedBase.add(previousPath);
    consumedHead.add(nextPath);
    documents.push(documentDiff("renamed", nextPath, previous, next, base, head, previousPath));
  }

  for (const [documentPath, next] of head.documents) {
    if (consumedHead.has(documentPath)) {
      continue;
    }
    const previous = base.documents.get(documentPath);
    if (!previous) {
      documents.push(documentDiff("added", documentPath, undefined, next, base, head));
      continue;
    }
    consumedBase.add(documentPath);
    if (previous.hash !== next.hash || previous.status !== next.status || previous.type !== next.type) {
      documents.push(documentDiff("modified", documentPath, previous, next, base, head));
    }
  }

  for (const [documentPath, previous] of base.documents) {
    if (!consumedBase.has(documentPath) && !head.documents.has(documentPath)) {
      documents.push(documentDiff("deleted", documentPath, previous, undefined, base, head));
    }
  }

  return documents.sort((left, right) => (left.previousPath ?? left.path).localeCompare(right.previousPath ?? right.path) || left.path.localeCompare(right.path));
}

function documentDiff(
  change: GraphDiffDocument["change"],
  documentPath: string,
  previous: GraphDocument | undefined,
  next: GraphDocument | undefined,
  base: GraphSnapshot,
  head: GraphSnapshot,
  previousPath?: string
): GraphDiffDocument {
  const beforePath = previous?.path ?? previousPath ?? documentPath;
  const afterPath = next?.path ?? documentPath;
  const warningCodes = sortedWarningCodes([
    ...base.warningCodesByDocument.get(beforePath) ?? [],
    ...head.warningCodesByDocument.get(afterPath) ?? []
  ]);
  return {
    path: documentPath,
    previousPath,
    change,
    hashChanged: previous && next ? previous.hash !== next.hash : true,
    statusChanged: previous && next ? previous.status !== next.status : undefined,
    sectionDelta: (next ? head.sectionCounts.get(afterPath) ?? 0 : 0) - (previous ? base.sectionCounts.get(beforePath) ?? 0 : 0),
    sourceRefDelta: (next ? head.sourceRefCounts.get(afterPath) ?? 0 : 0) - (previous ? base.sourceRefCounts.get(beforePath) ?? 0 : 0),
    warningCodes: warningCodes.length ? warningCodes : undefined
  };
}

function sectionCountsByDocument(documents: GraphDocument[], sections: GraphSection[]): Map<string, number> {
  const pathById = new Map(documents.map((document) => [document.id, document.path]));
  const counts = new Map<string, number>();
  for (const section of sections) {
    const documentPath = pathById.get(section.documentId);
    if (documentPath) {
      counts.set(documentPath, (counts.get(documentPath) ?? 0) + 1);
    }
  }
  return counts;
}

function sourceRefCountsByDocument(documents: GraphDocument[], sourceRefs: SourceRef[], edges: GraphEdge[]): Map<string, number> {
  const pathByDocumentId = new Map(documents.map((document) => [document.id, document.path]));
  const sourceRefIds = new Set(sourceRefs.map((sourceRef) => sourceRef.id));
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind !== "REFERENCES_SOURCE") {
      continue;
    }
    const documentPath = pathByDocumentId.get(edge.fromId);
    if (documentPath && sourceRefIds.has(edge.toId)) {
      counts.set(documentPath, (counts.get(documentPath) ?? 0) + 1);
    }
  }
  return counts;
}

function warningCounts(report: DoctorReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const warning of report.warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  }
  return counts;
}

function warningCodesByDocument(warnings: DoctorWarning[]): Map<string, Set<string>> {
  const byDocument = new Map<string, Set<string>>();
  for (const warning of warnings) {
    for (const node of warning.affectedNodes) {
      if (!node.path || node.kind !== "document") {
        continue;
      }
      const current = byDocument.get(node.path) ?? new Set<string>();
      current.add(warning.code);
      byDocument.set(node.path, current);
    }
  }
  return byDocument;
}

function countDelta(base: Record<string, number>, head: Record<string, number>): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const code of [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()) {
    const value = (head[code] ?? 0) - (base[code] ?? 0);
    if (value !== 0) {
      delta[code] = value;
    }
  }
  return delta;
}

function setSymmetricDifference(base: Set<string>, head: Set<string>): string[] {
  return [...new Set([...base, ...head])]
    .filter((value) => base.has(value) !== head.has(value))
    .sort();
}

function affectedDocumentPaths(documents: GraphDiffDocument[], base: GraphSnapshot, head: GraphSnapshot): string[] {
  return [...new Set([
    ...documents.flatMap((document) => [document.previousPath, document.path]),
    ...base.warningCodesByDocument.keys(),
    ...head.warningCodesByDocument.keys()
  ].filter((value): value is string => Boolean(value)))].sort();
}

function prSummary(report: GraphDiffReport): string[] {
  const summary = [
    `Documents changed: +${report.summary.documentsAdded}, ~${report.summary.documentsModified}, -${report.summary.documentsDeleted}, renamed ${report.summary.documentsRenamed}.`,
    `Graph deltas: sections ${formatSigned(report.summary.sectionsChanged)}, source refs ${formatSigned(report.summary.sourceRefsChanged)}, edges ${formatSigned(report.summary.edgesChanged)}.`
  ];
  const warningDelta = Object.entries(report.summary.warningDelta);
  if (warningDelta.length) {
    summary.push(`Doctor warning delta: ${warningDelta.map(([code, delta]) => `${code} ${formatSigned(delta)}`).join(", ")}.`);
  }
  if (report.impact.changedSourceRefs.length) {
    summary.push(`Changed source refs: ${report.impact.changedSourceRefs.slice(0, 10).join(", ")}${report.impact.changedSourceRefs.length > 10 ? ", ..." : ""}.`);
  }
  return summary;
}

function createBaseSnapshot(projectRoot: string, revision: string): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-diff-base-"));
  const files = gitTrackedFiles(projectRoot, revision);
  for (const filePath of files) {
    writeBaseFile(projectRoot, tempRoot, revision, filePath);
  }
  const currentConfig = loadConfig(projectRoot);
  fs.mkdirSync(path.dirname(configPath(tempRoot)), { recursive: true });
  fs.writeFileSync(configPath(tempRoot), `${JSON.stringify(currentConfig, null, 2)}\n`, "utf8");
  return tempRoot;
}

function writeBaseFile(projectRoot: string, tempRoot: string, revision: string, gitPath: string): void {
  const target = safeOutputPath(tempRoot, gitPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!needsContent(gitPath)) {
    fs.writeFileSync(target, "");
    return;
  }
  const result = spawnSync("git", ["show", `${revision}:${gitPath}`], {
    cwd: projectRoot,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Failed to read ${gitPath} from ${revision}: ${bufferToString(result.stderr)}`);
  }
  fs.writeFileSync(target, result.stdout);
}

function needsContent(gitPath: string): boolean {
  return /\.(?:md|mdx)$/i.test(gitPath) || gitPath === ".gitignore";
}

function safeOutputPath(root: string, relativePath: string): string {
  const normalized = normalizePath(relativePath).replace(/^\/+/, "");
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path in Git tree: ${relativePath}`);
  }
  return resolved;
}

function resolveBaseRevision(projectRoot: string, baseRef: string): string {
  return runGitText(projectRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`]).trim();
}

function gitTrackedFiles(projectRoot: string, revision: string): string[] {
  return runGitText(projectRoot, ["ls-tree", "-r", "-z", "--name-only", revision])
    .split("\0")
    .filter(Boolean)
    .map(normalizePath);
}

function gitRenames(projectRoot: string, revision: string): Map<string, string> {
  const output = runGitText(projectRoot, ["diff", "--name-status", "--find-renames", revision]);
  const renames = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length >= 3 && parts[0]?.startsWith("R") && isMarkdownPath(parts[1]) && isMarkdownPath(parts[2])) {
      renames.set(normalizePath(parts[1]), normalizePath(parts[2]));
    }
  }
  return renames;
}

function runGitText(projectRoot: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Git command failed: git ${args.join(" ")}\n${result.stderr}`);
  }
  return result.stdout;
}

function formatDiffDocument(document: GraphDiffDocument): string {
  const renamed = document.previousPath ? `${document.previousPath} -> ${document.path}` : document.path;
  const details = [
    `sections ${formatSigned(document.sectionDelta ?? 0)}`,
    `source refs ${formatSigned(document.sourceRefDelta ?? 0)}`,
    document.warningCodes?.length ? `warnings ${document.warningCodes.join(",")}` : ""
  ].filter(Boolean);
  return `- ${document.change}: ${renamed}${details.length ? ` (${details.join("; ")})` : ""}`;
}

function sortedWarningCodes(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function isMarkdownPath(value: string): boolean {
  return /\.(?:md|mdx)$/i.test(value);
}

function bufferToString(value: unknown): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}
