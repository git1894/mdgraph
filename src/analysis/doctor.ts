import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { openDatabase } from "../db/connection.js";
import { GraphRepository, type DefinitionCollision, type DocumentLinkStats, type StorageDiagnostics } from "../db/repositories.js";
import { parseMarkdownDocument } from "../parser/markdown-parser.js";
import { LinkResolver } from "../resolution/link-resolver.js";
import { scanMarkdownFiles } from "../scanner/file-scanner.js";
import type { FrontmatterDiagnostic, GraphDocument, ParsedDocument, SourceRef } from "../types.js";
import { scanContentRiskLines } from "../utils/content-risk.js";
import { relativePathInsideRoot, resolveInsideRoot } from "../utils/path-safety.js";
import { normalizeEntityName, normalizePath } from "../utils/text.js";

export interface DeadLinkIssue {
  documentPath: string;
  line: number;
  target: string;
  kind: "markdown" | "wikilink";
}

export interface StaleSourceRefIssue {
  sourceRef: SourceRef;
  expectedPath: string;
  documentPaths: string[];
}

export interface MissingDefinitionIssue {
  document: GraphDocument;
}

export interface WeakLinkIssue {
  document: GraphDocument;
  nonContainmentEdges: number;
}

export interface ContentRiskIssue {
  documentPath: string;
  line: number;
  reason: string;
}

export interface FrontmatterDiagnosticIssue {
  documentPath: string;
  diagnostic: FrontmatterDiagnostic;
}

interface LifecycleReferenceIssue {
  code: "document.deprecated_referenced" | "document.superseded_referenced";
  sourceDocument: ParsedDocument;
  targetDocument: ParsedDocument;
  line: number;
  target: string;
  supersededBy?: string[];
}

interface SupersededDocumentIndex {
  ids: Set<string>;
  supersededBy: Map<string, string[]>;
}

interface MissingDecisionLinkIssue {
  document: ParsedDocument;
}

interface TagConventionIssue {
  document: ParsedDocument;
  tag: string;
}

interface LinkConventionIssue {
  document: ParsedDocument;
  line: number;
  target: string;
}

interface StorageWarningIssue {
  code: "storage.generated_path_indexed" | "storage.database_oversized" | "storage.fts_shadow_large" | "storage.high_degree_node" | "storage.vector_anomaly";
  severity: DoctorWarningSeverity;
  message: string;
  evidence: Record<string, unknown>;
  affectedNodes: DoctorWarningAffectedNode[];
  remediation: string;
}

export type DoctorWarningSeverity = "error" | "warn" | "info";

interface ParseFailureIssue {
  documentPath: string;
  reason: string;
}

export interface DoctorWarningAffectedNode {
  kind: string;
  id?: string;
  path?: string;
  line?: number;
  label?: string;
}

export interface DoctorWarning {
  code: string;
  severity: DoctorWarningSeverity;
  message: string;
  evidence: Record<string, unknown>;
  affectedNodes: DoctorWarningAffectedNode[];
  remediation: string;
}

export const DOCTOR_WARNING_CODES = [
  "index.stale",
  "link.dead",
  "source_ref.missing",
  "definition.missing",
  "definition.duplicate",
  "content.risk",
  "document.orphan",
  "document.deleted",
  "document.weakly_linked",
  "document.deprecated_referenced",
  "document.superseded_referenced",
  "document.parse_failed",
  "graph.missing_decision_link",
  "storage.generated_path_indexed",
  "storage.database_oversized",
  "storage.fts_shadow_large",
  "storage.high_degree_node",
  "storage.vector_anomaly",
  "front_matter.invalid_yaml",
  "front_matter.not_mapping",
  "front_matter.unclosed",
  "front_matter.invalid_field",
  "tag.invalid_format",
  "link.non_posix_path"
] as const;

export interface StaleIndexIssue {
  path: string;
  reason: "added" | "deleted" | "modified" | "id_changed";
  indexedId?: string;
  currentId?: string;
  indexedHash?: string;
  currentHash?: string;
}

export interface StaleIndexReport {
  stale: boolean;
  recommendation: string;
  issues: StaleIndexIssue[];
}

export interface DoctorScopeRename {
  from: string;
  to: string;
}

export interface DoctorScope {
  mode: "all" | "changed" | "since";
  baseRef?: string;
  changedPaths: string[];
  deletedPaths: string[];
  renamedPaths: DoctorScopeRename[];
  untrackedPaths: string[];
  globalHealthIncluded: boolean;
}

export interface DoctorHealthDocument {
  path: string;
  title: string;
  type: string;
  status: string;
  nonContainmentEdges: number;
}

export interface DoctorHealthDefinition {
  entityName: string;
  documentPaths: string[];
}

export interface DoctorStorageHealth {
  estimatedBytes: number;
  pageCount: number;
  freelistCount: number;
  journalMode: string;
  ftsShadowBytes?: number;
  pathGroups: StorageDiagnostics["pathGroups"];
  highDegreeNodes: StorageDiagnostics["highDegreeNodes"];
  vectorSummary: StorageDiagnostics["vectors"] & { expectedChunks: number };
  warnings: StorageWarningIssue[];
}

export interface DoctorHealth {
  graph: {
    mostConnectedDocs: DoctorHealthDocument[];
    weaklyLinkedDocs: DoctorHealthDocument[];
    duplicateDefinitions: DoctorHealthDefinition[];
    missingDefinitions: DoctorHealthDocument[];
    missingDecisionLinks: DoctorHealthDocument[];
  };
  storage: DoctorStorageHealth;
}

export interface DoctorOptions {
  scope?: DoctorScope;
  applySchema?: boolean;
}

export interface DoctorReport {
  projectRoot: string;
  scope: DoctorScope;
  summary: {
    documents: number;
    orphanDocs: number;
    deadLinks: number;
    staleSourceRefs: number;
    missingDefinitions: number;
    weaklyLinkedDocs: number;
    possibleContradictions: number;
    contentRisks: number;
    staleIndex: number;
  };
  staleIndex: StaleIndexReport;
  orphanDocs: GraphDocument[];
  deadLinks: DeadLinkIssue[];
  staleSourceRefs: StaleSourceRefIssue[];
  missingDefinitions: MissingDefinitionIssue[];
  weaklyLinkedDocs: WeakLinkIssue[];
  possibleContradictions: DefinitionCollision[];
  contentRisks: ContentRiskIssue[];
  frontmatterDiagnostics: FrontmatterDiagnosticIssue[];
  warnings: DoctorWarning[];
  health: DoctorHealth;
}

const docsThatShouldDefine = new Set(["design", "adr", "api", "runbook", "spec"]);
const warningSeverityRank: Record<DoctorWarningSeverity, number> = { error: 0, warn: 1, info: 2 };
const generatedPathGroups = new Set(["node_modules", "dist", "build", "coverage", ".next", ".cache", "tmp", "temp", "vendor"]);
const oversizedDatabaseBytes = 100 * 1024 * 1024;
const largeFtsShadowBytes = 50 * 1024 * 1024;
const highDegreeWarningThreshold = 50;
const tagConventionPattern = /^[a-z0-9][a-z0-9._/-]*$/;

export function allDoctorScope(): DoctorScope {
  return {
    mode: "all",
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [],
    untrackedPaths: [],
    globalHealthIncluded: true
  };
}

export async function runDoctor(projectRoot: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const scope = options.scope ?? allDoctorScope();
  const config = loadConfig(projectRoot);
  const files = await scanMarkdownFiles(projectRoot, config);
  const { parsedDocuments, parseFailures, scannedPaths } = parseDoctorDocuments(projectRoot, files);
  const resolver = new LinkResolver(parsedDocuments);
  const repository = new GraphRepository(openDatabase(projectRoot, { createIfMissing: false, applySchema: options.applySchema ?? true }));

  try {
    const scopePaths = buildScopePathSet(scope, parsedDocuments, repository);
    const storageHealth = storageHealthForScope(buildStorageHealth(repository.storageDiagnostics(), repository.counts().chunks), scope);
    const staleIndex = scopedStaleIndex(detectStaleIndex(parsedDocuments, repository.documentHashes(), scannedPaths), scope, scopePaths);
    if (staleIndex.stale) {
      return staleDoctorReport(projectRoot, scopedDocumentCount(parsedDocuments, scope, scopePaths), staleIndex, scope, storageHealth, parseFailures);
    }

    const stats = repository.documentLinkStats();
    const scopedStats = filterStatsByScope(stats, scope, scopePaths);
    const scopedParsedDocuments = filterParsedDocumentsByScope(parsedDocuments, scope, scopePaths);
    const orphanDocs = scopedStats
      .filter((item) => item.nonContainmentEdges === 0)
      .map((item) => item.document);
    const weaklyLinkedDocs = scopedStats
      .filter((item) => item.nonContainmentEdges > 0 && item.nonContainmentEdges < 2)
      .map((item) => ({ document: item.document, nonContainmentEdges: item.nonContainmentEdges }));
    const missingDefinitions = scopedStats
      .filter(shouldRequireDefinitions)
      .map((item) => ({ document: item.document }));
    const deadLinks = scopedParsedDocuments.flatMap((document) => [
      ...document.markdownLinks
        .filter((link) => isLocalDocumentLink(link.url) && !resolver.resolveMarkdownUrl(link.url, document))
        .map((link) => ({ documentPath: document.relativePath, line: link.line, target: link.url, kind: "markdown" as const })),
      ...document.wikiLinks
        .filter((link) => !resolver.resolveDocumentRef(link.target, document, link.anchor))
        .map((link) => ({ documentPath: document.relativePath, line: link.line, target: link.raw, kind: "wikilink" as const }))
    ]);
    const sourceRefDocumentPaths = sourceRefDocumentPathMap(parsedDocuments);
    const staleSourceRefs = repository.allSourceRefs()
      .map((sourceRef) => staleSourceRefIssue(projectRoot, sourceRef, sourceRefDocumentPaths.get(sourceRef.normalizedPath) ?? []))
      .filter((issue): issue is StaleSourceRefIssue => Boolean(issue))
      .filter((issue) => scope.mode === "all" || issue.documentPaths.some((documentPath) => pathInScope(documentPath, scope, scopePaths)));
    const collisionStopEntities = new Set(config.entities.stopEntities.map(normalizeEntityName));
    const possibleContradictions = repository.definitionCollisions()
      .filter((issue) => !collisionStopEntities.has(normalizeEntityName(issue.entity.name)))
      .filter((issue) => scope.mode === "all" || issue.documents.some((document) => pathInScope(document.path, scope, scopePaths)));
    const contentRisks = scopedParsedDocuments.flatMap((document) => scanDocumentContentRisks(document.relativePath, document.body));
    const frontmatterDiagnostics = scopedParsedDocuments.flatMap((document) => document.frontmatterDiagnostics
      .map((diagnostic) => ({ documentPath: document.relativePath, diagnostic })));
    const tagConventionIssues = scopedParsedDocuments.flatMap(detectTagConventionIssues);
    const linkConventionIssues = scopedParsedDocuments.flatMap(detectLinkConventionIssues);
    const lifecycleReferences = detectLifecycleReferences(parsedDocuments, resolver)
      .filter((issue) => scope.mode === "all" || pathInScope(issue.sourceDocument.relativePath, scope, scopePaths) || pathInScope(issue.targetDocument.relativePath, scope, scopePaths));
    const missingDecisionLinks = detectMissingDecisionLinks(scopedParsedDocuments);
    const health = buildDoctorHealth(scopedStats, possibleContradictions, missingDefinitions, missingDecisionLinks, storageHealth);
    const warnings = buildDoctorWarnings({
      staleIndex,
      orphanDocs,
      deadLinks,
      staleSourceRefs,
      missingDefinitions,
      weaklyLinkedDocs,
      possibleContradictions,
      contentRisks,
      frontmatterDiagnostics,
      tagConventionIssues,
      linkConventionIssues,
      lifecycleReferences,
      missingDecisionLinks,
      scope,
      parseFailures,
      storageWarnings: storageHealth.warnings
    });

    return {
      projectRoot,
      scope,
      summary: {
        documents: scopedStats.length,
        orphanDocs: orphanDocs.length,
        deadLinks: deadLinks.length,
        staleSourceRefs: staleSourceRefs.length,
        missingDefinitions: missingDefinitions.length,
        weaklyLinkedDocs: weaklyLinkedDocs.length,
        possibleContradictions: possibleContradictions.length,
        contentRisks: contentRisks.length,
        staleIndex: 0
      },
      staleIndex,
      orphanDocs,
      deadLinks,
      staleSourceRefs,
      missingDefinitions,
      weaklyLinkedDocs,
      possibleContradictions,
      contentRisks,
      frontmatterDiagnostics,
      warnings,
      health
    };
  } finally {
    repository.close();
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    "MDGraph health report",
    `Project: ${report.projectRoot}`,
    `Scope: ${formatDoctorScope(report.scope)}`,
    `Documents: ${report.summary.documents}`,
    `Orphan docs: ${report.summary.orphanDocs}`,
    `Dead links: ${report.summary.deadLinks}`,
    `Stale source refs: ${report.summary.staleSourceRefs}`,
    `Missing definitions: ${report.summary.missingDefinitions}`,
    `Weakly linked docs: ${report.summary.weaklyLinkedDocs}`,
    `Possible contradictions: ${report.summary.possibleContradictions}`,
    `Content risks: ${report.summary.contentRisks}`,
    `Stale index: ${report.summary.staleIndex}`,
    `Warnings: ${report.warnings.length}`
  ];

  if (report.staleIndex.stale) {
    lines.push("", "Stale index:", `- ${report.staleIndex.recommendation}`);
    for (const issue of report.staleIndex.issues.slice(0, 25)) {
      lines.push(`- ${issue.path}: ${issue.reason}`);
    }
    if (report.staleIndex.issues.length > 25) {
      lines.push(`- ... ${report.staleIndex.issues.length - 25} more`);
    }
    appendWarningGroups(lines, report.warnings);
    return lines.join("\n");
  }

  appendSection(lines, "Graph health: most connected docs", report.health.graph.mostConnectedDocs.map((document) => `${document.path} (${document.nonContainmentEdges} non-containment edges)`));
  appendSection(lines, "Graph health: missing decision links", report.health.graph.missingDecisionLinks.map((document) => document.path));
  appendSection(lines, "Storage health: path groups", report.health.storage.pathGroups.slice(0, 10).map((group) => `${group.group}: ${group.documents} docs, ${group.chunks} chunks, ${group.contentBytes} bytes`));
  appendSection(lines, "Dead links", report.deadLinks.map((issue) => `${issue.documentPath}:${issue.line} -> ${issue.target} (${issue.kind})`));
  appendSection(lines, "Stale source refs", report.staleSourceRefs.map((issue) => `${issue.sourceRef.path} (missing at ${issue.expectedPath})`));
  appendSection(lines, "Missing definitions", report.missingDefinitions.map((issue) => issue.document.path));
  appendSection(lines, "Weakly linked docs", report.weaklyLinkedDocs.map((issue) => `${issue.document.path} (${issue.nonContainmentEdges} non-containment edge)`));
  appendSection(lines, "Possible contradictions", report.possibleContradictions.map((issue) => `${issue.entity.name}: ${issue.documents.map((document) => document.path).join(", ")}`));
  appendSection(lines, "Content risks", report.contentRisks.map((issue) => `${issue.documentPath}:${issue.line} ${issue.reason}`));
  appendWarningGroups(lines, report.warnings);

  return lines.join("\n");
}

function formatDoctorScope(scope: DoctorScope): string {
  if (scope.mode === "all") {
    return "all";
  }
  const changed = scope.changedPaths.length + scope.deletedPaths.length + scope.renamedPaths.length + scope.untrackedPaths.length;
  return scope.mode === "since"
    ? `since ${scope.baseRef ?? "unknown"} (${changed} path(s), global health included: ${scope.globalHealthIncluded})`
    : `changed (${changed} path(s), global health included: ${scope.globalHealthIncluded})`;
}

function parseDoctorDocuments(projectRoot: string, files: string[]): {
  parsedDocuments: ParsedDocument[];
  parseFailures: ParseFailureIssue[];
  scannedPaths: Set<string>;
} {
  const parsedDocuments: ParsedDocument[] = [];
  const parseFailures: ParseFailureIssue[] = [];
  const scannedPaths = new Set<string>();
  for (const file of files) {
    const relativePath = relativePathInsideRoot(projectRoot, file) ?? normalizePath(path.relative(projectRoot, file));
    scannedPaths.add(relativePath);
    try {
      parsedDocuments.push(parseMarkdownDocument(projectRoot, file));
    } catch (error) {
      parseFailures.push({
        documentPath: relativePath,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { parsedDocuments, parseFailures, scannedPaths };
}

function staleSourceRefIssue(projectRoot: string, sourceRef: SourceRef, documentPaths: string[]): StaleSourceRefIssue | undefined {
  const expectedPath = resolveInsideRoot(projectRoot, sourceRef.path);
  if (!expectedPath) {
    return {
      sourceRef,
      expectedPath: "outside project root",
      documentPaths
    };
  }
  if (fs.existsSync(expectedPath)) {
    return undefined;
  }
  return { sourceRef, expectedPath, documentPaths };
}

function detectStaleIndex(
  parsedDocuments: ParsedDocument[],
  indexed: Map<string, { id: string; hash: string }>,
  currentPaths = new Set(parsedDocuments.map((document) => document.relativePath))
): StaleIndexReport {
  const issues: StaleIndexIssue[] = [];
  const currentByPath = new Map(parsedDocuments.map((document) => [document.relativePath, document]));

  for (const document of parsedDocuments) {
    const existing = indexed.get(document.relativePath);
    if (!existing) {
      issues.push({ path: document.relativePath, reason: "added", currentId: document.id, currentHash: document.hash });
      continue;
    }
    if (existing.id !== document.id) {
      issues.push({
        path: document.relativePath,
        reason: "id_changed",
        indexedId: existing.id,
        currentId: document.id,
        indexedHash: existing.hash,
        currentHash: document.hash
      });
      continue;
    }
    if (existing.hash !== document.hash) {
      issues.push({
        path: document.relativePath,
        reason: "modified",
        indexedId: existing.id,
        currentId: document.id,
        indexedHash: existing.hash,
        currentHash: document.hash
      });
    }
  }

  for (const [documentPath, existing] of indexed) {
    if (!currentPaths.has(documentPath)) {
      issues.push({ path: documentPath, reason: "deleted", indexedId: existing.id, indexedHash: existing.hash });
    }
  }

  const sortedIssues = issues.sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
  return {
    stale: sortedIssues.length > 0,
    recommendation: sortedIssues.length > 0
      ? "Index is stale; run `mdgraph index` before relying on doctor health conclusions."
      : "Index is fresh.",
    issues: sortedIssues
  };
}

function staleDoctorReport(
  projectRoot: string,
  documentCount: number,
  staleIndex: StaleIndexReport,
  scope: DoctorScope,
  storage: DoctorStorageHealth,
  parseFailures: ParseFailureIssue[]
): DoctorReport {
  return {
    projectRoot,
    scope,
    summary: {
      documents: documentCount,
      orphanDocs: 0,
      deadLinks: 0,
      staleSourceRefs: 0,
      missingDefinitions: 0,
      weaklyLinkedDocs: 0,
      possibleContradictions: 0,
      contentRisks: 0,
      staleIndex: staleIndex.issues.length
    },
    staleIndex,
    orphanDocs: [],
    deadLinks: [],
    staleSourceRefs: [],
    missingDefinitions: [],
    weaklyLinkedDocs: [],
    possibleContradictions: [],
    contentRisks: [],
    frontmatterDiagnostics: [],
    warnings: sortWarnings([...staleIndexWarnings(staleIndex), ...parseFailures.map(parseFailureWarning)]),
    health: buildEmptyDoctorHealth(storage)
  };
}

function buildDoctorWarnings(input: {
  staleIndex: StaleIndexReport;
  orphanDocs: GraphDocument[];
  deadLinks: DeadLinkIssue[];
  staleSourceRefs: StaleSourceRefIssue[];
  missingDefinitions: MissingDefinitionIssue[];
  weaklyLinkedDocs: WeakLinkIssue[];
  possibleContradictions: DefinitionCollision[];
  contentRisks: ContentRiskIssue[];
  frontmatterDiagnostics: FrontmatterDiagnosticIssue[];
  tagConventionIssues: TagConventionIssue[];
  linkConventionIssues: LinkConventionIssue[];
  lifecycleReferences: LifecycleReferenceIssue[];
  missingDecisionLinks: MissingDecisionLinkIssue[];
  scope: DoctorScope;
  parseFailures: ParseFailureIssue[];
  storageWarnings: StorageWarningIssue[];
}): DoctorWarning[] {
  return sortWarnings([
    ...staleIndexWarnings(input.staleIndex),
    ...input.parseFailures.map(parseFailureWarning),
    ...input.frontmatterDiagnostics.map(frontmatterDiagnosticWarning),
    ...deletedDocumentWarnings(input.scope),
    ...input.tagConventionIssues.map(tagConventionWarning),
    ...input.linkConventionIssues.map(linkConventionWarning),
    ...input.lifecycleReferences.map(lifecycleReferenceWarning),
    ...input.missingDecisionLinks.map(missingDecisionLinkWarning),
    ...input.storageWarnings.map(storageHealthWarning),
    ...input.deadLinks.map(deadLinkWarning),
    ...input.staleSourceRefs.map(staleSourceRefWarning),
    ...input.missingDefinitions.map(missingDefinitionWarning),
    ...input.possibleContradictions.map(duplicateDefinitionWarning),
    ...input.contentRisks.map(contentRiskWarning),
    ...input.orphanDocs.map(orphanDocWarning),
    ...input.weaklyLinkedDocs.map(weakLinkWarning)
  ]);
}

function deletedDocumentWarnings(scope: DoctorScope): DoctorWarning[] {
  if (scope.mode === "all") {
    return [];
  }
  return scope.deletedPaths.map((documentPath) => ({
    code: "document.deleted",
    severity: "info" as const,
    message: `Markdown document was deleted in scoped diff: ${documentPath}`,
    evidence: { documentPath, scope: scope.mode, baseRef: scope.baseRef },
    affectedNodes: [{ kind: "document", path: documentPath }],
    remediation: "If this deletion is intentional, keep it; otherwise restore the Markdown file and re-run mdgraph index. Run a full doctor check to find remaining inbound links."
  }));
}

function tagConventionWarning(issue: TagConventionIssue): DoctorWarning {
  return {
    code: "tag.invalid_format",
    severity: "info",
    message: `Front matter tag does not use lowercase slug format in ${issue.document.relativePath}: ${issue.tag}`,
    evidence: { documentPath: issue.document.relativePath, tag: issue.tag, expected: "lowercase slug using a-z, 0-9, dot, underscore, slash, or hyphen" },
    affectedNodes: [parsedDocumentNode(issue.document)],
    remediation: "Rename the tag to a lowercase slug, for example docs/governance or release-checklist."
  };
}

function linkConventionWarning(issue: LinkConventionIssue): DoctorWarning {
  return {
    code: "link.non_posix_path",
    severity: "info",
    message: `Local Markdown link should use forward slashes in ${issue.document.relativePath}`,
    evidence: { documentPath: issue.document.relativePath, line: issue.line, target: issue.target },
    affectedNodes: [{ kind: "document", id: issue.document.id, path: issue.document.relativePath, line: issue.line, label: issue.document.title }],
    remediation: "Use POSIX-style / separators in Markdown links so the path is portable across platforms."
  };
}

function buildDoctorHealth(
  stats: DocumentLinkStats[],
  duplicateDefinitions: DefinitionCollision[],
  missingDefinitions: MissingDefinitionIssue[],
  missingDecisionLinks: MissingDecisionLinkIssue[],
  storage: DoctorStorageHealth
): DoctorHealth {
  return {
    graph: {
      mostConnectedDocs: stats
        .filter((item) => item.nonContainmentEdges > 0)
        .sort((left, right) => right.nonContainmentEdges - left.nonContainmentEdges || left.document.path.localeCompare(right.document.path))
        .slice(0, 10)
        .map(documentHealthFromStats),
      weaklyLinkedDocs: stats
        .filter((item) => item.nonContainmentEdges > 0 && item.nonContainmentEdges < 2)
        .map(documentHealthFromStats),
      duplicateDefinitions: duplicateDefinitions.map((issue) => ({
        entityName: issue.entity.name,
        documentPaths: issue.documents.map((document) => document.path)
      })),
      missingDefinitions: missingDefinitions.map((issue) => documentHealth(issue.document, 0)),
      missingDecisionLinks: missingDecisionLinks.map((issue) => parsedDocumentHealth(issue.document))
    },
    storage
  };
}

function buildEmptyDoctorHealth(storage: DoctorStorageHealth): DoctorHealth {
  return {
    graph: {
      mostConnectedDocs: [],
      weaklyLinkedDocs: [],
      duplicateDefinitions: [],
      missingDefinitions: [],
      missingDecisionLinks: []
    },
    storage
  };
}

function documentHealthFromStats(item: DocumentLinkStats): DoctorHealthDocument {
  return documentHealth(item.document, item.nonContainmentEdges);
}

function documentHealth(document: GraphDocument, nonContainmentEdges: number): DoctorHealthDocument {
  return {
    path: document.path,
    title: document.title,
    type: document.type,
    status: document.status,
    nonContainmentEdges
  };
}

function parsedDocumentHealth(document: ParsedDocument): DoctorHealthDocument {
  return {
    path: document.relativePath,
    title: document.title,
    type: document.frontmatter.type ?? "other",
    status: documentStatus(document),
    nonContainmentEdges: 0
  };
}

function buildStorageHealth(storage: StorageDiagnostics, expectedChunks: number): DoctorStorageHealth {
  const ftsShadowBytes = sumDefined(storage.objects.entries
    .filter((entry) => entry.category === "fts_shadow")
    .map((entry) => entry.bytes));
  const base: DoctorStorageHealth = {
    estimatedBytes: storage.database.estimatedBytes,
    pageCount: storage.database.pageCount,
    freelistCount: storage.database.freelistCount,
    journalMode: storage.database.journalMode,
    ftsShadowBytes,
    pathGroups: storage.pathGroups,
    highDegreeNodes: storage.highDegreeNodes,
    vectorSummary: { ...storage.vectors, expectedChunks },
    warnings: []
  };
  return { ...base, warnings: buildStorageWarnings(base) };
}

function buildStorageWarnings(storage: DoctorStorageHealth): StorageWarningIssue[] {
  return [
    ...storage.pathGroups
      .filter((group) => generatedPathGroups.has(group.group))
      .map((group): StorageWarningIssue => ({
        code: "storage.generated_path_indexed",
        severity: "warn",
        message: `Generated or dependency path group is indexed: ${group.group}`,
        evidence: { ...group },
        affectedNodes: [{ kind: "path_group", path: group.group }],
        remediation: "Add this path group to docs.exclude unless these Markdown files are authored project documentation."
      })),
    ...(storage.estimatedBytes > oversizedDatabaseBytes ? [{
      code: "storage.database_oversized" as const,
      severity: "warn" as const,
      message: `Graph database is larger than ${oversizedDatabaseBytes} bytes.`,
      evidence: { estimatedBytes: storage.estimatedBytes, thresholdBytes: oversizedDatabaseBytes },
      affectedNodes: [{ kind: "database" }],
      remediation: "Review indexed path groups and run a full reindex after excluding generated or dependency folders."
    }] : []),
    ...(storage.ftsShadowBytes !== undefined && (storage.ftsShadowBytes > largeFtsShadowBytes || storage.ftsShadowBytes > storage.estimatedBytes * 0.6) ? [{
      code: "storage.fts_shadow_large" as const,
      severity: "info" as const,
      message: "FTS shadow tables dominate database storage.",
      evidence: { ftsShadowBytes: storage.ftsShadowBytes, estimatedBytes: storage.estimatedBytes },
      affectedNodes: [{ kind: "database" }],
      remediation: "Run a full reindex or review unusually large Markdown content if search storage keeps growing."
    }] : []),
    ...storage.highDegreeNodes
      .filter((node) => node.degree >= highDegreeWarningThreshold)
      .map((node): StorageWarningIssue => ({
        code: "storage.high_degree_node",
        severity: "info",
        message: `High-degree graph node: ${node.label}`,
        evidence: { ...node },
        affectedNodes: [{ kind: node.kind, id: node.id, label: node.label }],
        remediation: "Review whether this node is a broad utility concept that should be scoped, renamed, or ignored."
      })),
    ...(storage.vectorSummary.total > 0 && storage.vectorSummary.total !== storage.vectorSummary.expectedChunks ? [{
      code: "storage.vector_anomaly" as const,
      severity: "warn" as const,
      message: "Chunk vector count does not match indexed chunk count.",
      evidence: { vectors: storage.vectorSummary.total, expectedChunks: storage.vectorSummary.expectedChunks },
      affectedNodes: [{ kind: "database" }],
      remediation: "Run a full semantic reindex so vector rows match current chunks."
    }] : [])
  ];
}

function storageHealthForScope(storage: DoctorStorageHealth, scope: DoctorScope): DoctorStorageHealth {
  return scope.globalHealthIncluded ? storage : { ...storage, warnings: [] };
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number");
  return defined.length ? defined.reduce((total, value) => total + value, 0) : undefined;
}

function lifecycleReferenceWarning(issue: LifecycleReferenceIssue): DoctorWarning {
  const supersededBy = issue.supersededBy?.length ? ` Superseded by: ${issue.supersededBy.join(", ")}.` : "";
  return {
    code: issue.code,
    severity: "warn",
    message: `Active document ${issue.sourceDocument.relativePath} references ${issue.targetDocument.relativePath}.${supersededBy}`,
    evidence: {
      sourceDocumentPath: issue.sourceDocument.relativePath,
      targetDocumentPath: issue.targetDocument.relativePath,
      target: issue.target,
      line: issue.line,
      supersededBy: issue.supersededBy
    },
    affectedNodes: [
      parsedDocumentNode(issue.sourceDocument, issue.line),
      parsedDocumentNode(issue.targetDocument)
    ],
    remediation: issue.code === "document.deprecated_referenced"
      ? "Update the link to an active replacement document or remove the deprecated reference."
      : "Update the link to the superseding document or mark the target document status appropriately."
  };
}

function missingDecisionLinkWarning(issue: MissingDecisionLinkIssue): DoctorWarning {
  return {
    code: "graph.missing_decision_link",
    severity: "info",
    message: `Decision document has no explicit graph relationship links: ${issue.document.relativePath}`,
    evidence: { documentPath: issue.document.relativePath, documentType: issue.document.frontmatter.type ?? "other" },
    affectedNodes: [parsedDocumentNode(issue.document)],
    remediation: "Add depends_on, supersedes, deprecated_by, a Markdown link, or a WikiLink to connect this decision to related docs."
  };
}

function storageHealthWarning(issue: StorageWarningIssue): DoctorWarning {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    evidence: issue.evidence,
    affectedNodes: issue.affectedNodes,
    remediation: issue.remediation
  };
}

function frontmatterDiagnosticWarning(issue: FrontmatterDiagnosticIssue): DoctorWarning {
  return {
    code: issue.diagnostic.code,
    severity: "warn",
    message: `Front matter diagnostic in ${issue.documentPath}: ${issue.diagnostic.message}`,
    evidence: {
      documentPath: issue.documentPath,
      line: issue.diagnostic.line,
      field: issue.diagnostic.field,
      expected: issue.diagnostic.expected,
      actual: issue.diagnostic.actual
    },
    affectedNodes: [{ kind: "document", path: issue.documentPath, line: issue.diagnostic.line }],
    remediation: frontmatterRemediation(issue.diagnostic)
  };
}

function parseFailureWarning(issue: ParseFailureIssue): DoctorWarning {
  return {
    code: "document.parse_failed",
    severity: "error",
    message: `Markdown document could not be parsed: ${issue.documentPath}`,
    evidence: { documentPath: issue.documentPath, reason: issue.reason },
    affectedNodes: [{ kind: "document", path: issue.documentPath }],
    remediation: "Reduce extreme Markdown nesting/size or fix malformed content, then re-run mdgraph index and doctor."
  };
}

function frontmatterRemediation(diagnostic: FrontmatterDiagnostic): string {
  if (diagnostic.code === "front_matter.invalid_field") {
    return "Use the documented MDGraph front matter field shape, or move project-specific metadata to a custom field name.";
  }
  if (diagnostic.code === "front_matter.unclosed") {
    return "Close the YAML front matter block with a standalone --- delimiter, or remove the opening delimiter.";
  }
  return "Fix the YAML front matter so it parses as a mapping, or remove the front matter block.";
}

function staleIndexWarnings(staleIndex: StaleIndexReport): DoctorWarning[] {
  return sortWarnings(staleIndex.issues.map((issue) => ({
    code: "index.stale",
    severity: "error" as const,
    message: `Indexed document is ${issue.reason}: ${issue.path}`,
    evidence: {
      path: issue.path,
      reason: issue.reason,
      indexedId: issue.indexedId,
      currentId: issue.currentId,
      indexedHash: issue.indexedHash,
      currentHash: issue.currentHash
    },
    affectedNodes: [{ kind: "document", path: issue.path }],
    remediation: staleIndex.recommendation
  })));
}

function deadLinkWarning(issue: DeadLinkIssue): DoctorWarning {
  return {
    code: "link.dead",
    severity: "error",
    message: `Dead ${issue.kind} link in ${issue.documentPath}`,
    evidence: { target: issue.target, kind: issue.kind, documentPath: issue.documentPath, line: issue.line },
    affectedNodes: [{ kind: "document", path: issue.documentPath, line: issue.line }],
    remediation: "Update the link target or create the referenced Markdown document."
  };
}

function staleSourceRefWarning(issue: StaleSourceRefIssue): DoctorWarning {
  return {
    code: "source_ref.missing",
    severity: "error",
    message: `Source reference does not exist: ${issue.sourceRef.path}`,
    evidence: { sourcePath: issue.sourceRef.path, expectedPath: issue.expectedPath },
    affectedNodes: [{ kind: "source_ref", id: issue.sourceRef.id, path: issue.sourceRef.path }],
    remediation: "Create the referenced source path, or update/remove the source_refs or implements front matter entry."
  };
}

function missingDefinitionWarning(issue: MissingDefinitionIssue): DoctorWarning {
  return {
    code: "definition.missing",
    severity: "warn",
    message: `Document has no definition edges: ${issue.document.path}`,
    evidence: { documentPath: issue.document.path, documentType: issue.document.type },
    affectedNodes: [documentNode(issue.document)],
    remediation: "Add a defines front matter entry or high-confidence definition heading, or change the document type."
  };
}

function duplicateDefinitionWarning(issue: DefinitionCollision): DoctorWarning {
  return {
    code: "definition.duplicate",
    severity: "warn",
    message: `Definition appears in multiple active documents: ${issue.entity.name}`,
    evidence: { entityName: issue.entity.name, documentPaths: issue.documents.map((document) => document.path) },
    affectedNodes: [
      { kind: "entity", id: issue.entity.id, label: issue.entity.name },
      ...issue.documents.map(documentNode)
    ],
    remediation: "Keep one authoritative definition, or rename/scope the duplicated entity definitions."
  };
}

function contentRiskWarning(issue: ContentRiskIssue): DoctorWarning {
  return {
    code: "content.risk",
    severity: "warn",
    message: `Potentially risky document content in ${issue.documentPath}`,
    evidence: { reason: issue.reason, documentPath: issue.documentPath, line: issue.line },
    affectedNodes: [{ kind: "document", path: issue.documentPath, line: issue.line }],
    remediation: "Review the content and remove or isolate prompt-injection text, active HTML, data URIs, or hidden characters."
  };
}

function orphanDocWarning(document: GraphDocument): DoctorWarning {
  return {
    code: "document.orphan",
    severity: "info",
    message: `Document has no non-containment graph edges: ${document.path}`,
    evidence: { documentPath: document.path, nonContainmentEdges: 0 },
    affectedNodes: [documentNode(document)],
    remediation: "Link this document from related docs, add source_refs, or add explicit front matter relationships."
  };
}

function weakLinkWarning(issue: WeakLinkIssue): DoctorWarning {
  return {
    code: "document.weakly_linked",
    severity: "info",
    message: `Document has few non-containment graph edges: ${issue.document.path}`,
    evidence: { documentPath: issue.document.path, nonContainmentEdges: issue.nonContainmentEdges },
    affectedNodes: [documentNode(issue.document)],
    remediation: "Add links, source_refs, or front matter relationships when this document should participate in the graph."
  };
}

function documentNode(document: GraphDocument): DoctorWarningAffectedNode {
  return { kind: "document", id: document.id, path: document.path, label: document.title };
}

function parsedDocumentNode(document: ParsedDocument, line?: number): DoctorWarningAffectedNode {
  return { kind: "document", id: document.id, path: document.relativePath, line, label: document.title };
}

function detectLifecycleReferences(documents: ParsedDocument[], resolver: LinkResolver): LifecycleReferenceIssue[] {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const superseded = supersededDocuments(documents, resolver, documentById);
  const issues: LifecycleReferenceIssue[] = [];

  for (const document of documents) {
    if (!isActiveDocument(document)) {
      continue;
    }
    const references = [
      ...document.markdownLinks.map((link) => ({
        line: link.line,
        target: link.url,
        resolved: resolver.resolveMarkdownUrl(link.url, document)
      })),
      ...document.wikiLinks.map((link) => ({
        line: link.line,
        target: link.raw,
        resolved: resolver.resolveDocumentRef(link.target, document, link.anchor)
      }))
    ];

    for (const reference of references) {
      const targetDocument = reference.resolved ? documentById.get(reference.resolved.documentId) : undefined;
      if (!targetDocument || targetDocument.id === document.id) {
        continue;
      }
      if (documentStatus(targetDocument) === "deprecated") {
        issues.push({
          code: "document.deprecated_referenced",
          sourceDocument: document,
          targetDocument,
          line: reference.line,
          target: reference.target
        });
      }
      if (superseded.ids.has(targetDocument.id)) {
        issues.push({
          code: "document.superseded_referenced",
          sourceDocument: document,
          targetDocument,
          line: reference.line,
          target: reference.target,
          supersededBy: superseded.supersededBy.get(targetDocument.id)
        });
      }
    }
  }

  return issues;
}

function supersededDocuments(documents: ParsedDocument[], resolver: LinkResolver, documentById: Map<string, ParsedDocument>): SupersededDocumentIndex {
  const ids = new Set<string>();
  const supersededBy = new Map<string, string[]>();
  for (const document of documents) {
    if (documentStatus(document) === "superseded" || document.frontmatter.deprecated_by?.length) {
      ids.add(document.id);
    }
    for (const reference of document.frontmatter.deprecated_by ?? []) {
      const resolved = resolver.resolveDocumentRef(reference, document);
      const replacementDocument = resolved ? documentById.get(resolved.documentId) : undefined;
      if (replacementDocument && replacementDocument.id !== document.id) {
        addSupersedingDocument(supersededBy, document.id, replacementDocument.relativePath);
      }
    }
    if (!isActiveDocument(document)) {
      continue;
    }
    for (const reference of document.frontmatter.supersedes ?? []) {
      const resolved = resolver.resolveDocumentRef(reference, document);
      const targetDocument = resolved ? documentById.get(resolved.documentId) : undefined;
      if (!targetDocument || targetDocument.id === document.id) {
        continue;
      }
      ids.add(targetDocument.id);
      addSupersedingDocument(supersededBy, targetDocument.id, document.relativePath);
    }
  }
  return { ids, supersededBy };
}

function addSupersedingDocument(supersededBy: Map<string, string[]>, targetDocumentId: string, replacementPath: string): void {
  const existing = supersededBy.get(targetDocumentId) ?? [];
  supersededBy.set(targetDocumentId, [...new Set([...existing, replacementPath])].sort());
}

function detectMissingDecisionLinks(documents: ParsedDocument[]): MissingDecisionLinkIssue[] {
  return documents
    .filter((document) => document.frontmatter.type === "adr" && isActiveDocument(document))
    .filter((document) => !hasDecisionRelationship(document))
    .map((document) => ({ document }));
}

function detectTagConventionIssues(document: ParsedDocument): TagConventionIssue[] {
  return [...new Set(document.frontmatter.tags ?? [])]
    .filter((tag) => !tagConventionPattern.test(tag))
    .map((tag) => ({ document, tag }));
}

function detectLinkConventionIssues(document: ParsedDocument): LinkConventionIssue[] {
  return document.markdownLinks
    .filter((link) => isLocalDocumentLink(link.url) && link.url.includes("\\"))
    .map((link) => ({ document, line: link.line, target: link.url }));
}

function hasDecisionRelationship(document: ParsedDocument): boolean {
  return Boolean(
    document.frontmatter.depends_on?.length
    || document.frontmatter.supersedes?.length
    || document.frontmatter.deprecated_by?.length
    || document.markdownLinks.some((link) => isLocalDocumentLink(link.url))
    || document.wikiLinks.length
  );
}

function scopedStaleIndex(staleIndex: StaleIndexReport, scope: DoctorScope, scopePaths: Set<string>): StaleIndexReport {
  if (scope.mode === "all") {
    return staleIndex;
  }
  const issues = staleIndex.issues.filter((issue) => pathInScope(issue.path, scope, scopePaths));
  return {
    stale: issues.length > 0,
    recommendation: issues.length > 0
      ? "Scoped index is stale; run `mdgraph index` before relying on scoped doctor results."
      : "Scoped index is fresh.",
    issues
  };
}

function filterStatsByScope(stats: DocumentLinkStats[], scope: DoctorScope, scopePaths: Set<string>): DocumentLinkStats[] {
  return scope.mode === "all" ? stats : stats.filter((item) => pathInScope(item.document.path, scope, scopePaths));
}

function filterParsedDocumentsByScope(documents: ParsedDocument[], scope: DoctorScope, scopePaths: Set<string>): ParsedDocument[] {
  return scope.mode === "all" ? documents : documents.filter((document) => pathInScope(document.relativePath, scope, scopePaths));
}

function scopedDocumentCount(documents: ParsedDocument[], scope: DoctorScope, scopePaths: Set<string>): number {
  return filterParsedDocumentsByScope(documents, scope, scopePaths).length;
}

function pathInScope(documentPath: string, scope: DoctorScope, scopePaths: Set<string>): boolean {
  if (scope.mode === "all") {
    return true;
  }
  return scopePaths.has(normalizePath(documentPath));
}

function buildScopePathSet(scope: DoctorScope, documents: ParsedDocument[], repository: GraphRepository): Set<string> {
  const paths = baseScopePathSet(scope);
  if (scope.mode === "all") {
    return paths;
  }

  const documentsByPath = new Map(documents.map((document) => [normalizePath(document.relativePath), document]));
  for (const documentPath of [...paths]) {
    const document = documentsByPath.get(documentPath);
    if (document) {
      for (const relatedPath of relatedDocumentPaths(document, repository)) {
        paths.add(relatedPath);
      }
    }
  }
  return paths;
}

function baseScopePathSet(scope: DoctorScope): Set<string> {
  return new Set([
    ...scope.changedPaths,
    ...scope.deletedPaths,
    ...scope.untrackedPaths,
    ...scope.renamedPaths.flatMap((rename) => [rename.from, rename.to])
  ].map(normalizePath));
}

function relatedDocumentPaths(document: ParsedDocument, repository: GraphRepository): string[] {
  const nodeIds = [document.id, ...document.sections.map((section) => section.id)];
  const paths = nodeIds.flatMap((nodeId) => repository.edgesForNode(nodeId)
    .flatMap((edge) => [documentPathForNode(edge.fromId, repository), documentPathForNode(edge.toId, repository)]));
  return [...new Set(paths.filter((value): value is string => Boolean(value)).map(normalizePath))].sort();
}

function documentPathForNode(nodeId: string, repository: GraphRepository): string | undefined {
  const node = repository.getNode(nodeId);
  if (!node) {
    return undefined;
  }
  const data = node.data as { path?: unknown; documentId?: unknown };
  if (node.kind === "document" && typeof data.path === "string") {
    return data.path;
  }
  if ((node.kind === "section" || node.kind === "chunk") && typeof data.documentId === "string") {
    const documentNode = repository.getNode(data.documentId);
    const documentData = documentNode?.data as { path?: unknown } | undefined;
    return documentNode?.kind === "document" && typeof documentData?.path === "string" ? documentData.path : undefined;
  }
  return undefined;
}

function sourceRefDocumentPathMap(documents: ParsedDocument[]): Map<string, string[]> {
  const bySourceRef = new Map<string, string[]>();
  for (const document of documents) {
    for (const sourcePath of [...(document.frontmatter.implements ?? []), ...(document.frontmatter.source_refs ?? [])]) {
      const key = normalizePath(sourcePath.trim()).toLowerCase();
      if (!key) {
        continue;
      }
      const existing = bySourceRef.get(key) ?? [];
      bySourceRef.set(key, [...new Set([...existing, document.relativePath])].sort());
    }
  }
  return bySourceRef;
}

function isActiveDocument(document: ParsedDocument): boolean {
  return documentStatus(document) === "active";
}

function documentStatus(document: ParsedDocument): string {
  return (document.frontmatter.status ?? "active").trim().toLowerCase();
}

function sortWarnings(warnings: DoctorWarning[]): DoctorWarning[] {
  return [...warnings].sort((left, right) => warningSortKey(left).localeCompare(warningSortKey(right)));
}

function warningSortKey(warning: DoctorWarning): string {
  const node = warning.affectedNodes[0];
  return [
    warningSeverityRank[warning.severity],
    warning.code,
    node?.path ?? node?.label ?? node?.id ?? "",
    node?.line ?? 0,
    warning.message
  ].join("|");
}

function shouldRequireDefinitions(item: DocumentLinkStats): boolean {
  return docsThatShouldDefine.has(item.document.type) && item.definitionEdges === 0;
}

function isLocalDocumentLink(url: string): boolean {
  return !/^(?:https?:|mailto:|#)/i.test(url) && /(?:\.mdx?|#)/i.test(url);
}

function scanDocumentContentRisks(documentPath: string, content: string): ContentRiskIssue[] {
  return scanContentRiskLines(content).map((risk) => ({ documentPath, ...risk }));
}

function appendSection(lines: string[], title: string, items: string[]): void {
  if (!items.length) {
    return;
  }
  lines.push("", `${title}:`);
  for (const item of items.slice(0, 25)) {
    lines.push(`- ${item}`);
  }
  if (items.length > 25) {
    lines.push(`- ... ${items.length - 25} more`);
  }
}

function appendWarningGroups(lines: string[], warnings: DoctorWarning[]): void {
  if (!warnings.length) {
    return;
  }
  lines.push("", "Warnings by severity/code:");
  const groups = new Map<string, DoctorWarning[]>();
  for (const warning of warnings) {
    const key = `${warning.severity}:${warning.code}`;
    groups.set(key, [...groups.get(key) ?? [], warning]);
  }
  const sortedGroups = [...groups.entries()].sort(([leftKey], [rightKey]) => {
    const [leftSeverity, leftCode] = leftKey.split(":", 2) as [DoctorWarningSeverity, string];
    const [rightSeverity, rightCode] = rightKey.split(":", 2) as [DoctorWarningSeverity, string];
    return warningSeverityRank[leftSeverity] - warningSeverityRank[rightSeverity] || leftCode.localeCompare(rightCode);
  });
  for (const [key, groupWarnings] of sortedGroups) {
    const [severity, code] = key.split(":", 2);
    lines.push(`${severity.toUpperCase()} ${code} (${groupWarnings.length}):`);
    for (const warning of groupWarnings.slice(0, 25)) {
      lines.push(`- ${warning.message}`);
    }
    if (groupWarnings.length > 25) {
      lines.push(`- ... ${groupWarnings.length - 25} more`);
    }
  }
}
