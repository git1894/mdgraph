import { loadConfig } from "./config/load-config.js";
import { openDatabase } from "./db/connection.js";
import { GraphRepository, type StatusCounts } from "./db/repositories.js";
import { buildGraphRecords } from "./extraction/graph-builder.js";
import { parseMarkdownDocument } from "./parser/markdown-parser.js";
import { scanMarkdownFiles } from "./scanner/file-scanner.js";
import type { GraphRecordSet, MDGraphConfig } from "./types.js";
import { relativePathInsideRoot } from "./utils/path-safety.js";

export interface IndexResult {
  files: number;
  changed: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  mode: "full" | "incremental";
  counts: StatusCounts;
}

export interface IndexOptions {
  full?: boolean;
  semantic?: boolean;
}

export async function indexProject(projectRoot: string, options: IndexOptions = {}): Promise<IndexResult> {
  const config = effectiveConfig(loadConfig(projectRoot), options);
  const files = await scanMarkdownFiles(projectRoot, config);
  const { parsed, skippedFiles } = parseScannedFiles(projectRoot, files);
  const records = buildGraphRecords(parsed, config);
  const db = openDatabase(projectRoot);
  try {
    const repository = new GraphRepository(db);
    if (options.full || repository.counts().documents === 0) {
      repository.replaceAll(records);
      return {
        files: files.length,
        changed: parsed.length,
        deleted: 0,
        unchanged: 0,
        skipped: skippedFiles.length,
        skippedFiles,
        mode: "full",
        counts: repository.counts()
      };
    }

    const existing = repository.documentHashes();
    const currentPaths = new Set(files.map((file) => relativePathInsideRoot(projectRoot, file)).filter((value): value is string => Boolean(value)));
    const changedDocuments = parsed.filter((document) => existing.get(document.relativePath)?.hash !== document.hash);
    const deletedDocumentIds = [...existing.entries()]
      .filter(([documentPath]) => !currentPaths.has(documentPath))
      .map(([, document]) => document.id);
    if (changedDocuments.length || deletedDocumentIds.length) {
      const changedIds = new Set(changedDocuments.map((document) => document.id));
      const replacedDocumentIds = changedDocuments
        .map((document) => existing.get(document.relativePath)?.id)
        .filter((existingId): existingId is string => typeof existingId === "string" && !changedIds.has(existingId));
      repository.replaceDocuments(filterRecordsForDocuments(records, changedIds), [...changedIds], [...deletedDocumentIds, ...replacedDocumentIds]);
    }

    return {
      files: files.length,
      changed: changedDocuments.length,
      deleted: deletedDocumentIds.length,
      unchanged: files.length - changedDocuments.length - skippedFiles.length,
      skipped: skippedFiles.length,
      skippedFiles,
      mode: "incremental",
      counts: repository.counts()
    };
  } finally {
    db.close();
  }
}

function parseScannedFiles(projectRoot: string, files: string[]): {
  parsed: ReturnType<typeof parseMarkdownDocument>[];
  skippedFiles: IndexResult["skippedFiles"];
} {
  const parsed: ReturnType<typeof parseMarkdownDocument>[] = [];
  const skippedFiles: IndexResult["skippedFiles"] = [];
  for (const file of files) {
    try {
      parsed.push(parseMarkdownDocument(projectRoot, file));
    } catch (error) {
      skippedFiles.push({
        path: relativePathInsideRoot(projectRoot, file) ?? file,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { parsed, skippedFiles };
}

function effectiveConfig(config: MDGraphConfig, options: IndexOptions): MDGraphConfig {
  if (options.semantic === undefined) {
    return config;
  }
  return {
    ...config,
    embedding: {
      ...config.embedding,
      enabled: options.semantic
    }
  };
}

function filterRecordsForDocuments(records: GraphRecordSet, documentIds: Set<string>): GraphRecordSet {
  const sectionIds = new Set(records.sections.filter((section) => documentIds.has(section.documentId)).map((section) => section.id));
  const chunkIds = new Set(records.chunks.filter((chunk) => documentIds.has(chunk.documentId)).map((chunk) => chunk.id));
  const ownedNodeIds = new Set<string>([...documentIds, ...sectionIds, ...chunkIds]);
  const changedEdges = records.edges.filter((edge) => ownedNodeIds.has(edge.fromId) || ownedNodeIds.has(edge.toId));
  const referencedEntityIds = new Set(changedEdges.flatMap((edge) => [edge.fromId, edge.toId]));

  return {
    documents: records.documents.filter((document) => documentIds.has(document.id)),
    sections: records.sections.filter((section) => sectionIds.has(section.id)),
    entities: records.entities.filter((entity) => referencedEntityIds.has(entity.id)),
    sourceRefs: records.sourceRefs.filter((sourceRef) => referencedEntityIds.has(sourceRef.id)),
    edges: changedEdges,
    chunks: records.chunks.filter((chunk) => chunkIds.has(chunk.id)),
    vectors: records.vectors.filter((vector) => chunkIds.has(vector.chunkId))
  };
}
