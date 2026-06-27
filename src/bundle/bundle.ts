import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { configPath, databasePath, loadConfig } from "../config/load-config.js";
import { createDatabase } from "../db/sqlite-adapter.js";
import { openExistingDatabase } from "../db/connection.js";
import { GraphRepository, type StatusCounts } from "../db/repositories.js";
import type { MDGraphConfig } from "../types.js";
import { readBoundedJsonFile } from "../utils/bounded-json.js";
import { packageVersion } from "../version.js";

export type BundleVisibility = "private";

export interface BundleDocumentManifestEntry {
  path: string;
  hash: string;
}

export interface SourceSnapshot {
  configHash: string;
  documents: BundleDocumentManifestEntry[];
  documentsHash: string;
  sourceHash: string;
}

export interface GraphBundleManifest {
  format: "mdgraph-bundle";
  formatVersion: 1;
  schemaVersion: number;
  mdgraphVersion: string;
  createdAt: string;
  visibility: BundleVisibility;
  sourceHash: string;
  configHash: string;
  provenance: {
    command: string;
    gitRevision?: string;
    gitDirty?: boolean;
    indexedAt: string;
  };
  counts: StatusCounts;
  documents: {
    count: number;
    hash: string;
  };
  reports?: Record<string, { path: string; sha256: string }>;
}

export interface BundleCreateResult {
  bundleDir: string;
  manifestPath: string;
  manifest: GraphBundleManifest;
}

export interface BundleVerificationResult {
  bundleDir: string;
  valid: boolean;
  errors: string[];
  manifest?: GraphBundleManifest;
  counts?: StatusCounts;
  schemaVersion?: number;
  sourceHash?: string;
  configHash?: string;
  freshness: {
    state: "fresh" | "stale" | "unknown";
    reason: string;
  };
}

export async function createGraphBundle(projectRoot: string, options: { profile?: string } = {}): Promise<BundleCreateResult> {
  const profile = options.profile ?? "private";
  if (profile !== "private") {
    throw new Error(`Unsupported bundle profile: ${profile}. MDGraph 0.6 only supports private directory bundles.`);
  }

  const resolvedRoot = path.resolve(projectRoot);
  const dbPath = databasePath(resolvedRoot);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`MDGraph database not found at ${dbPath}. Run \`mdgraph index\` before creating a bundle.`);
  }

  const config = loadConfig(resolvedRoot);
  const repository = new GraphRepository(openExistingDatabase(resolvedRoot));
  let manifest: GraphBundleManifest;
  let statusStorageReport: { counts: StatusCounts; storage: ReturnType<GraphRepository["storageDiagnostics"]> };
  try {
    const counts = repository.counts();
    const storage = repository.storageDiagnostics();
    const schema = repository.schemaMetadata();
    const source = sourceSnapshot(config, repository.allDocuments().map((document) => ({ path: document.path, hash: document.hash })));
    const createdAt = new Date().toISOString();
    statusStorageReport = { counts, storage };
    manifest = {
      format: "mdgraph-bundle",
      formatVersion: 1,
      schemaVersion: schema.schemaVersion,
      mdgraphVersion: packageVersion(),
      createdAt,
      visibility: "private",
      sourceHash: source.sourceHash,
      configHash: source.configHash,
      provenance: {
        command: "mdgraph bundle create --profile private",
        gitRevision: gitRevision(resolvedRoot),
        gitDirty: gitDirty(resolvedRoot),
        indexedAt: repository.latestIndexedAt() ?? createdAt
      },
      counts,
      documents: {
        count: source.documents.length,
        hash: source.documentsHash
      }
    };
    repository.checkpointStorage();
  } finally {
    repository.close();
  }

  const bundleDir = path.join(resolvedRoot, ".mdgraph", "bundles", "private", safeTimestamp(manifest.createdAt));
  const reportsDir = path.join(bundleDir, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const configSnapshotPath = path.join(bundleDir, "config.json");
  fs.writeFileSync(configSnapshotPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.copyFileSync(dbPath, path.join(bundleDir, "graph.db"));

  const reportPath = path.join(reportsDir, "status-storage.json");
  writeJson(reportPath, statusStorageReport);
  manifest.reports = {
    "status-storage": {
      path: "reports/status-storage.json",
      sha256: fileHash(reportPath)
    }
  };

  const manifestPath = path.join(bundleDir, "manifest.json");
  writeJson(manifestPath, manifest);
  return { bundleDir, manifestPath, manifest };
}

export function verifyGraphBundle(bundleDir: string, options: { projectRoot?: string } = {}): BundleVerificationResult {
  const resolvedBundleDir = path.resolve(bundleDir);
  const errors: string[] = [];
  const manifestPath = path.join(resolvedBundleDir, "manifest.json");
  const graphPath = path.join(resolvedBundleDir, "graph.db");
  const configSnapshotPath = path.join(resolvedBundleDir, "config.json");
  const graphExists = fs.existsSync(graphPath);
  const configExists = fs.existsSync(configSnapshotPath);

  const manifest = readManifest(manifestPath, errors);
  if (!graphExists) {
    errors.push("Missing graph.db.");
  }
  if (!configExists) {
    errors.push("Missing config.json.");
  }
  if (!manifest) {
    return {
      bundleDir: resolvedBundleDir,
      valid: false,
      errors,
      freshness: { state: "unknown", reason: "manifest could not be read" }
    };
  }

  validateManifestShape(manifest, errors);

  let counts: StatusCounts | undefined;
  let schemaVersion: number | undefined;
  let sourceHash: string | undefined;
  let configHash: string | undefined;
  if (graphExists && configExists) {
    try {
      const config = readJsonFile(configSnapshotPath) as MDGraphConfig;
      const db = createDatabase(graphPath);
      const repository = new GraphRepository(db);
      try {
        counts = repository.counts();
        schemaVersion = repository.schemaMetadata().schemaVersion;
        const source = sourceSnapshot(config, repository.allDocuments().map((document) => ({ path: document.path, hash: document.hash })));
        sourceHash = source.sourceHash;
        configHash = source.configHash;
        if (sourceHash !== manifest.sourceHash) {
          errors.push("Manifest sourceHash does not match bundled config and document hashes.");
        }
        if (configHash !== manifest.configHash) {
          errors.push("Manifest configHash does not match bundled config.json.");
        }
        if (schemaVersion !== manifest.schemaVersion) {
          errors.push(`Manifest schemaVersion ${manifest.schemaVersion} does not match bundled database schemaVersion ${schemaVersion}.`);
        }
        if (isStatusCounts(manifest.counts)) {
          compareCounts(manifest.counts, counts, errors);
        }
        if (isDocumentSummary(manifest.documents)) {
          if (source.documentsHash !== manifest.documents.hash) {
            errors.push("Manifest documents hash does not match bundled database documents.");
          }
          if (source.documents.length !== manifest.documents.count) {
            errors.push(`Manifest document count ${manifest.documents.count} does not match bundled database document count ${source.documents.length}.`);
          }
        }
      } finally {
        repository.close();
      }
    } catch (error) {
      errors.push(`Failed to inspect bundled graph.db: ${errorMessage(error)}`);
    }
  }

  if (manifest.reports) {
    for (const [name, report] of Object.entries(manifest.reports)) {
      const reportPath = resolveBundlePath(resolvedBundleDir, report.path);
      if (!reportPath) {
        errors.push(`Invalid report path for ${name}: ${String(report.path)}.`);
        continue;
      }
      if (!fs.existsSync(reportPath)) {
        errors.push(`Missing report ${name}: ${report.path}.`);
      } else if (fileHash(reportPath) !== report.sha256) {
        errors.push(`Report hash mismatch for ${name}.`);
      }
    }
  }

  const freshness = bundleFreshness(manifest, options.projectRoot);
  return {
    bundleDir: resolvedBundleDir,
    valid: errors.length === 0,
    errors,
    manifest,
    counts,
    schemaVersion,
    sourceHash,
    configHash,
    freshness
  };
}

export function sourceSnapshot(config: MDGraphConfig, documents: BundleDocumentManifestEntry[]): SourceSnapshot {
  const sortedDocuments = [...documents].sort((left, right) => left.path.localeCompare(right.path));
  const configHash = hashCanonical(config);
  const documentsHash = hashCanonical(sortedDocuments);
  const sourceHash = hashCanonical({ configHash, documents: sortedDocuments });
  return { configHash, documents: sortedDocuments, documentsHash, sourceHash };
}

export function hashCanonical(value: unknown): string {
  return hashString(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

function bundleFreshness(manifest: GraphBundleManifest, projectRoot: string | undefined): BundleVerificationResult["freshness"] {
  if (!projectRoot) {
    return { state: "unknown", reason: "no project root supplied" };
  }
  const resolvedRoot = path.resolve(projectRoot);
  const dbPath = databasePath(resolvedRoot);
  if (!fs.existsSync(dbPath)) {
    return { state: "unknown", reason: "current workspace is not indexed" };
  }
  try {
    const config = loadConfig(resolvedRoot);
    const repository = new GraphRepository(openExistingDatabase(resolvedRoot));
    try {
      const current = sourceSnapshot(config, repository.allDocuments().map((document) => ({ path: document.path, hash: document.hash })));
      return current.sourceHash === manifest.sourceHash
        ? { state: "fresh", reason: "bundle source hash matches current workspace index" }
        : { state: "stale", reason: "bundle source hash differs from current workspace index" };
    } finally {
      repository.close();
    }
  } catch (error) {
    return { state: "unknown", reason: errorMessage(error) };
  }
}

function readManifest(manifestPath: string, errors: string[]): GraphBundleManifest | undefined {
  if (!fs.existsSync(manifestPath)) {
    errors.push("Missing manifest.json.");
    return undefined;
  }
  try {
    return readJsonFile(manifestPath) as GraphBundleManifest;
  } catch (error) {
    errors.push(`Invalid manifest.json: ${errorMessage(error)}.`);
    return undefined;
  }
}

function validateManifestShape(manifest: GraphBundleManifest, errors: string[]): void {
  if (manifest.format !== "mdgraph-bundle") {
    errors.push("Manifest format must be mdgraph-bundle.");
  }
  if (manifest.formatVersion !== 1) {
    errors.push(`Unsupported bundle formatVersion: ${manifest.formatVersion}.`);
  }
  if (manifest.visibility !== "private") {
    errors.push(`Unsupported bundle visibility: ${manifest.visibility}.`);
  }
  if (!isStatusCounts(manifest.counts)) {
    errors.push("Manifest counts must include documents, sections, entities, sourceRefs, edges, chunks, and vectors.");
  }
  if (!isDocumentSummary(manifest.documents)) {
    errors.push("Manifest documents summary must include count and hash.");
  }
}

function compareCounts(expected: StatusCounts, actual: StatusCounts, errors: string[]): void {
  for (const key of Object.keys(expected) as Array<keyof StatusCounts>) {
    if (expected[key] !== actual[key]) {
      errors.push(`Count mismatch for ${key}: manifest=${expected[key]}, database=${actual[key]}.`);
    }
  }
}

function isStatusCounts(value: unknown): value is StatusCounts {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return ["documents", "sections", "entities", "sourceRefs", "edges", "chunks", "vectors"].every((key) => typeof record[key] === "number");
}

function isDocumentSummary(value: unknown): value is GraphBundleManifest["documents"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.count === "number" && typeof record.hash === "string";
}

function readJsonFile(filePath: string): unknown {
  return readBoundedJsonFile(filePath, "Bundle JSON file");
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveBundlePath(bundleDir: string, relativePath: unknown): string | undefined {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    return undefined;
  }
  const resolved = path.resolve(bundleDir, relativePath);
  const relative = path.relative(bundleDir, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : undefined;
}

function fileHash(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function gitRevision(projectRoot: string): string | undefined {
  return runGit(projectRoot, ["rev-parse", "HEAD"]);
}

function gitDirty(projectRoot: string): boolean | undefined {
  const status = runGit(projectRoot, ["status", "--porcelain"]);
  return status === undefined ? undefined : status.length > 0;
}

function runGit(projectRoot: string, args: string[]): string | undefined {
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    return undefined;
  }
  try {
    const result = spawnSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
