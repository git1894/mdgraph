import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openExistingDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { buildMermaidTraceExport, formatTraceMermaid } from "../src/export/diagram.js";
import { buildGraphJsonExport, graphJsonHash, readGraphJsonFile, verifyGraphJsonExport } from "../src/export/graphjson.js";
import { buildDocsSiteIndex, formatObsidianMarkdownIndex } from "../src/export/markdown-index.js";
import { buildCodeGraphBridgeReport } from "../src/export/source-bridge.js";
import { indexProject } from "../src/indexer.js";
import { traceNodes } from "../src/query/trace.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("v0.7 interoperability exports", () => {
  it("exports deterministic structural GraphJSON without content or local paths", async () => {
    const root = makeTempRoot("mdgraph-graphjson-");
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const first = buildGraphJsonExport(root, repository);
      const second = buildGraphJsonExport(root, repository);
      expect(first).toEqual(second);
      expect(first.format).toBe("mdgraph-graphjson");
      expect(first.formatVersion).toBe(1);
      expect(first.exportProfile).toBe("structural");
      expect(first.counts).toEqual(repository.counts());
      expect(first.exportedCounts.nodes).toBe(first.nodes.length);
      expect(first.exportedCounts.edges).toBe(first.edges.length);
      expect(first.graphHash).toBe(graphJsonHash(first));
      expect(first.nodes.some((node) => node.kind === "document" && node.path === "docs/auth-v2-design.md")).toBe(true);
      expect(first.nodes.some((node) => node.kind === "entity" && node.label === "AuthService")).toBe(true);
      expect(first.nodes.some((node) => node.kind === "source_ref" && node.path === "src/auth/AuthService.ts")).toBe(true);
      expect(first.edges.every((edge) => first.nodes.some((node) => node.id === edge.fromId) && first.nodes.some((node) => node.id === edge.toId))).toBe(true);
      const serialized = JSON.stringify(first);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain("graph.db");
      expect(serialized).not.toContain("handles `RedisTimeoutError`");
      expect(first.nodes.every((node) => node.kind !== "chunk" && node.kind !== "vector")).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("verifies GraphJSON and reports actionable validation failures", async () => {
    const root = makeTempRoot("mdgraph-graphjson-verify-");
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const graph = buildGraphJsonExport(root, repository);
      expect(verifyGraphJsonExport(graph).valid).toBe(true);

      const missingEndpoint = {
        ...graph,
        edges: [{ ...graph.edges[0], toId: "missing-node" }]
      };
      const missingEndpointResult = verifyGraphJsonExport(missingEndpoint);
      expect(missingEndpointResult.valid).toBe(false);
      expect(missingEndpointResult.errors.some((error) => error.code === "graphjson.edge_endpoint")).toBe(true);

      const futureVersion = { ...graph, formatVersion: 999 };
      const futureVersionResult = verifyGraphJsonExport(futureVersion);
      expect(futureVersionResult.valid).toBe(false);
      expect(futureVersionResult.errors.some((error) => error.code === "graphjson.format_version")).toBe(true);

      const countMismatch = { ...graph, exportedCounts: { ...graph.exportedCounts, nodes: 1 } };
      const countMismatchResult = verifyGraphJsonExport(countMismatch);
      expect(countMismatchResult.valid).toBe(false);
      expect(countMismatchResult.errors.some((error) => error.code === "graphjson.count_mismatch")).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("rejects GraphJSON files that exceed JSON structure budgets", () => {
    const root = makeTempRoot("mdgraph-graphjson-budget-");
    const file = path.join(root, "deep.json");
    fs.writeFileSync(file, nestedJson(130), "utf8");

    expect(() => readGraphJsonFile(file)).toThrow(/JSON depth/);
  });

  it("exports deterministic Mermaid trace diagrams and no-path comments", async () => {
    const root = makeTempRoot("mdgraph-mermaid-");
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const trace = traceNodes(repository, "AuthService", "RedisTimeoutError", 6);
      const exportResult = buildMermaidTraceExport(trace);
      expect(exportResult.format).toBe("mdgraph-mermaid");
      expect(exportResult.found).toBe(true);
      expect(exportResult.diagram).toContain("flowchart LR");
      expect(exportResult.diagram).toContain("REFERENCES /");
      expect(exportResult.diagram).toContain("AuthService");
      expect(formatTraceMermaid(trace)).toBe(exportResult.diagram);

      const missing = traceNodes(repository, "AuthService", "MissingNode", 1);
      const missingDiagram = formatTraceMermaid(missing);
      expect(missingDiagram).toContain("%% End node not found");
      expect(missingDiagram).toContain("flowchart LR");
    } finally {
      repository.close();
    }
  });

  it("exports Markdown and docs-site indexes from GraphJSON without absolute paths", async () => {
    const root = makeTempRoot("mdgraph-docsite-");
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const graph = buildGraphJsonExport(root, repository);
      const index = buildDocsSiteIndex(graph);
      const markdown = formatObsidianMarkdownIndex(graph);
      expect(index.format).toBe("mdgraph-docsite-index");
      expect(index.documents.some((document) => document.path === "docs/auth-v2-design.md" && document.defines.includes("AuthService"))).toBe(true);
      expect(index.documents.some((document) => document.sourceRefs.includes("src/auth/AuthService.ts"))).toBe(true);
      expect(markdown).toContain("[[docs/auth-v2-design.md]]");
      expect(JSON.stringify(index)).not.toContain(root);
      expect(markdown).not.toContain(root);
    } finally {
      repository.close();
    }
  });

  it("builds a read-only CodeGraph bridge report without changing graph counts", async () => {
    const root = makeTempRoot("mdgraph-source-bridge-");
    createFixtureDocs(root);
    await indexProject(root);
    const artifactPath = path.join(root, "codegraph.json");
    fs.writeFileSync(artifactPath, JSON.stringify({
      files: [
        { path: "src/auth/AuthService.ts", symbols: [{ name: "AuthService", kind: "class" }] }
      ]
    }), "utf8");

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const before = repository.counts();
      const unsupported = buildCodeGraphBridgeReport(repository);
      expect(unsupported.status).toBe("unsupported");
      expect(unsupported.reason).toContain("No CodeGraph artifact");

      const invalidArtifact = path.join(root, "invalid-codegraph.json");
      fs.writeFileSync(invalidArtifact, "{", "utf8");
      const invalid = buildCodeGraphBridgeReport(repository, { artifact: invalidArtifact });
      expect(invalid.status).toBe("unsupported");
      expect(invalid.reason).toContain("could not be parsed");

      const deepArtifactPath = path.join(root, "deep-codegraph.json");
      fs.writeFileSync(deepArtifactPath, nestedJson(130), "utf8");
      const deep = buildCodeGraphBridgeReport(repository, { artifact: deepArtifactPath });
      expect(deep.status).toBe("unsupported");
      expect(deep.reason).toContain("JSON depth");

      const report = buildCodeGraphBridgeReport(repository, { artifact: artifactPath });
      expect(report.status).toBe("ready");
      expect(report.matched).toEqual([{
        sourceRef: "src/auth/AuthService.ts",
        artifactPath: "src/auth/AuthService.ts",
        symbols: [{ name: "AuthService", kind: "class" }]
      }]);
      expect(repository.counts()).toEqual(before);
    } finally {
      repository.close();
    }
  });
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function nestedJson(depth: number): string {
  let value = "\"leaf\"";
  for (let index = 0; index < depth; index += 1) {
    value = `{"child":${value}}`;
  }
  return value;
}
