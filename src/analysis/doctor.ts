import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type DefinitionCollision, type DocumentLinkStats } from "../db/repositories.js";
import { parseMarkdownDocument } from "../parser/markdown-parser.js";
import { LinkResolver } from "../resolution/link-resolver.js";
import { scanMarkdownFiles } from "../scanner/file-scanner.js";
import type { GraphDocument, ParsedDocument, SourceRef } from "../types.js";
import { normalizeEntityName } from "../utils/text.js";

export interface DeadLinkIssue {
  documentPath: string;
  line: number;
  target: string;
  kind: "markdown" | "wikilink";
}

export interface StaleSourceRefIssue {
  sourceRef: SourceRef;
  expectedPath: string;
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

export interface DoctorReport {
  projectRoot: string;
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
}

const docsThatShouldDefine = new Set(["design", "adr", "api", "runbook", "spec"]);

export async function runDoctor(projectRoot: string): Promise<DoctorReport> {
  const config = loadConfig(projectRoot);
  const files = await scanMarkdownFiles(projectRoot, config);
  const parsedDocuments = files.map((file) => parseMarkdownDocument(projectRoot, file));
  const resolver = new LinkResolver(parsedDocuments);
  const repository = new GraphRepository(openExistingDatabase(projectRoot));

  try {
    const staleIndex = detectStaleIndex(parsedDocuments, repository.documentHashes());
    if (staleIndex.stale) {
      return staleDoctorReport(projectRoot, parsedDocuments.length, staleIndex);
    }

    const stats = repository.documentLinkStats();
    const orphanDocs = stats
      .filter((item) => item.nonContainmentEdges === 0)
      .map((item) => item.document);
    const weaklyLinkedDocs = stats
      .filter((item) => item.nonContainmentEdges > 0 && item.nonContainmentEdges < 2)
      .map((item) => ({ document: item.document, nonContainmentEdges: item.nonContainmentEdges }));
    const missingDefinitions = stats
      .filter(shouldRequireDefinitions)
      .map((item) => ({ document: item.document }));
    const deadLinks = parsedDocuments.flatMap((document) => [
      ...document.markdownLinks
        .filter((link) => isLocalDocumentLink(link.url) && !resolver.resolveMarkdownUrl(link.url, document))
        .map((link) => ({ documentPath: document.relativePath, line: link.line, target: link.url, kind: "markdown" as const })),
      ...document.wikiLinks
        .filter((link) => !resolver.resolveDocumentRef(link.target, document, link.anchor))
        .map((link) => ({ documentPath: document.relativePath, line: link.line, target: link.raw, kind: "wikilink" as const }))
    ]);
    const staleSourceRefs = repository.allSourceRefs()
      .map((sourceRef) => ({ sourceRef, expectedPath: path.join(projectRoot, sourceRef.path) }))
      .filter((issue) => !fs.existsSync(issue.expectedPath));
    const collisionStopEntities = new Set(config.entities.stopEntities.map(normalizeEntityName));
    const possibleContradictions = repository.definitionCollisions()
      .filter((issue) => !collisionStopEntities.has(normalizeEntityName(issue.entity.name)));
    const contentRisks = parsedDocuments.flatMap((document) => scanContentRisks(document.relativePath, document.body));

    return {
      projectRoot,
      summary: {
        documents: stats.length,
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
      contentRisks
    };
  } finally {
    repository.close();
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    "MDGraph health report",
    `Project: ${report.projectRoot}`,
    `Documents: ${report.summary.documents}`,
    `Orphan docs: ${report.summary.orphanDocs}`,
    `Dead links: ${report.summary.deadLinks}`,
    `Stale source refs: ${report.summary.staleSourceRefs}`,
    `Missing definitions: ${report.summary.missingDefinitions}`,
    `Weakly linked docs: ${report.summary.weaklyLinkedDocs}`,
    `Possible contradictions: ${report.summary.possibleContradictions}`,
    `Content risks: ${report.summary.contentRisks}`,
    `Stale index: ${report.summary.staleIndex}`
  ];

  if (report.staleIndex.stale) {
    lines.push("", "Stale index:", `- ${report.staleIndex.recommendation}`);
    for (const issue of report.staleIndex.issues.slice(0, 25)) {
      lines.push(`- ${issue.path}: ${issue.reason}`);
    }
    if (report.staleIndex.issues.length > 25) {
      lines.push(`- ... ${report.staleIndex.issues.length - 25} more`);
    }
    return lines.join("\n");
  }

  appendSection(lines, "Dead links", report.deadLinks.map((issue) => `${issue.documentPath}:${issue.line} -> ${issue.target} (${issue.kind})`));
  appendSection(lines, "Stale source refs", report.staleSourceRefs.map((issue) => `${issue.sourceRef.path} (missing at ${issue.expectedPath})`));
  appendSection(lines, "Missing definitions", report.missingDefinitions.map((issue) => issue.document.path));
  appendSection(lines, "Weakly linked docs", report.weaklyLinkedDocs.map((issue) => `${issue.document.path} (${issue.nonContainmentEdges} non-containment edge)`));
  appendSection(lines, "Possible contradictions", report.possibleContradictions.map((issue) => `${issue.entity.name}: ${issue.documents.map((document) => document.path).join(", ")}`));
  appendSection(lines, "Content risks", report.contentRisks.map((issue) => `${issue.documentPath}:${issue.line} ${issue.reason}`));

  return lines.join("\n");
}

function detectStaleIndex(parsedDocuments: ParsedDocument[], indexed: Map<string, { id: string; hash: string }>): StaleIndexReport {
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
    if (!currentByPath.has(documentPath)) {
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

function staleDoctorReport(projectRoot: string, documentCount: number, staleIndex: StaleIndexReport): DoctorReport {
  return {
    projectRoot,
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
    contentRisks: []
  };
}

function shouldRequireDefinitions(item: DocumentLinkStats): boolean {
  return docsThatShouldDefine.has(item.document.type) && item.definitionEdges === 0;
}

function isLocalDocumentLink(url: string): boolean {
  return !/^(?:https?:|mailto:|#)/i.test(url) && /(?:\.mdx?|#)/i.test(url);
}

function scanContentRisks(documentPath: string, content: string): ContentRiskIssue[] {
  const risks: ContentRiskIssue[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (lower.includes("ignore previous instructions") || lower.includes("system prompt")) {
      risks.push({ documentPath, line: index + 1, reason: "possible prompt injection text" });
    }
    if (/<\s*(script|iframe)\b/i.test(line)) {
      risks.push({ documentPath, line: index + 1, reason: "HTML script or iframe" });
    }
    if (/data:text\/html|data:application\/javascript/i.test(line)) {
      risks.push({ documentPath, line: index + 1, reason: "active data URI" });
    }
    if (/\p{Cf}/u.test(line)) {
      risks.push({ documentPath, line: index + 1, reason: "hidden Unicode format character" });
    }
  });
  return risks;
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