import fs from "node:fs";
import path from "node:path";
import type { GraphRepository } from "../db/repositories.js";
import { readBoundedJsonFile } from "../utils/bounded-json.js";
import { normalizePath } from "../utils/text.js";

export interface SourceBridgeReport {
  format: "mdgraph-source-bridge";
  formatVersion: 1;
  provider: "codegraph";
  status: "ready" | "unsupported";
  reason?: string;
  sourceRefs: number;
  matched: SourceBridgeMatch[];
  unmatched: string[];
}

export interface SourceBridgeMatch {
  sourceRef: string;
  artifactPath: string;
  symbols: Array<{ name: string; kind?: string }>;
}

interface CodeGraphArtifact {
  files?: Array<{
    path?: unknown;
    symbols?: Array<{ name?: unknown; kind?: unknown }>;
  }>;
}

export function buildCodeGraphBridgeReport(repository: GraphRepository, options: { artifact?: string } = {}): SourceBridgeReport {
  const sourceRefs = repository.allSourceRefs();
  if (!options.artifact) {
    return {
      format: "mdgraph-source-bridge",
      formatVersion: 1,
      provider: "codegraph",
      status: "unsupported",
      reason: "No CodeGraph artifact supplied; pass --artifact <file> to run the read-only bridge spike.",
      sourceRefs: sourceRefs.length,
      matched: [],
      unmatched: sourceRefs.map((sourceRef) => sourceRef.path)
    };
  }

  const artifactPath = path.resolve(options.artifact);
  if (!fs.existsSync(artifactPath)) {
    return {
      format: "mdgraph-source-bridge",
      formatVersion: 1,
      provider: "codegraph",
      status: "unsupported",
      reason: `CodeGraph artifact not found: ${options.artifact}`,
      sourceRefs: sourceRefs.length,
      matched: [],
      unmatched: sourceRefs.map((sourceRef) => sourceRef.path)
    };
  }

  let artifact: CodeGraphArtifact;
  try {
    artifact = readBoundedJsonFile(artifactPath, "CodeGraph artifact") as CodeGraphArtifact;
  } catch (error) {
    return {
      format: "mdgraph-source-bridge",
      formatVersion: 1,
      provider: "codegraph",
      status: "unsupported",
      reason: `CodeGraph artifact could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      sourceRefs: sourceRefs.length,
      matched: [],
      unmatched: sourceRefs.map((sourceRef) => sourceRef.path)
    };
  }
  const files = new Map<string, NonNullable<CodeGraphArtifact["files"]>[number]>();
  for (const file of artifact.files ?? []) {
    if (typeof file.path === "string") {
      files.set(normalizePath(file.path).toLowerCase(), file);
    }
  }

  const matched: SourceBridgeMatch[] = [];
  const unmatched: string[] = [];
  for (const sourceRef of sourceRefs) {
    const file = files.get(sourceRef.normalizedPath);
    if (!file || typeof file.path !== "string") {
      unmatched.push(sourceRef.path);
      continue;
    }
    matched.push({
      sourceRef: sourceRef.path,
      artifactPath: normalizePath(file.path),
      symbols: (file.symbols ?? [])
        .filter((symbol) => typeof symbol.name === "string")
        .map((symbol) => ({
          name: String(symbol.name),
          kind: typeof symbol.kind === "string" ? symbol.kind : undefined
        }))
        .sort((left, right) => left.name.localeCompare(right.name) || String(left.kind ?? "").localeCompare(String(right.kind ?? "")))
    });
  }

  return {
    format: "mdgraph-source-bridge",
    formatVersion: 1,
    provider: "codegraph",
    status: "ready",
    sourceRefs: sourceRefs.length,
    matched: matched.sort((left, right) => left.sourceRef.localeCompare(right.sourceRef)),
    unmatched: unmatched.sort((left, right) => left.localeCompare(right))
  };
}
