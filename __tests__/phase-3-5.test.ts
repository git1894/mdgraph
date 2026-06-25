import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, databasePath, loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { ToolHandler } from "../src/mcp/tools.js";
import { runDoctor } from "../src/analysis/doctor.js";
import { searchGraph } from "../src/query/search.js";
import { stableId } from "../src/utils/id.js";
import { watchProject } from "../src/watcher/file-watcher.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("phase 3 incremental indexing", () => {
  it("updates changed documents and removes deleted documents", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-incremental-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const first = await indexProject(root);
    expect(first.mode).toBe("full");

    const authPath = path.join(root, "docs", "auth-v2-design.md");
    fs.appendFileSync(authPath, "\n`AuthSessionStore` coordinates retries.\n", "utf8");
    const second = await indexProject(root);
    expect(second.mode).toBe("incremental");
    expect(second.changed).toBe(1);
    expect(second.deleted).toBe(0);

    fs.rmSync(path.join(root, "docs", "redis-cache-design.md"));
    const third = await indexProject(root);
    expect(third.mode).toBe("incremental");
    expect(third.deleted).toBe(1);
    expect(third.counts.documents).toBe(1);

    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.resolveNode("Redis Cache Design")).toBeUndefined();
      expect(repository.resolveNode("AuthSessionStore")?.kind).toBe("entity");
    } finally {
      repository.close();
    }
  });

  it("cleans up semantic vectors during incremental updates", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-incremental-vectors-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const first = await indexProject(root, { semantic: true });
    expect(first.counts.vectors).toBe(first.counts.chunks);

    fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## AuthSessionStore\n\n`AuthSessionStore` coordinates retries.\n", "utf8");
    const second = await indexProject(root, { semantic: true });
    expect(second.changed).toBe(1);
    expect(second.counts.vectors).toBe(second.counts.chunks);

    fs.rmSync(path.join(root, "docs", "redis-cache-design.md"));
    const third = await indexProject(root, { semantic: true });
    expect(third.deleted).toBe(1);
    expect(third.counts.vectors).toBe(third.counts.chunks);

    const db = openDatabase(root);
    try {
      const orphanRow = db.prepare(`
        SELECT count(*) AS count
        FROM chunk_vectors vector
        LEFT JOIN chunks chunk ON chunk.id = vector.chunk_id
        WHERE chunk.id IS NULL
      `).get() as { count: number };
      expect(orphanRow.count).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("phase 4 semantic search", () => {
  it("indexes local vectors and can include semantic matches", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-semantic-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const result = await indexProject(root, { semantic: true });
    expect(result.counts.vectors).toBeGreaterThan(0);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const results = searchGraph(repository, loadConfig(root), "session refresh RedisTimeoutError", 5, { semantic: true });
      expect(results.some((item) => item.reason.includes("semantic"))).toBe(true);
    } finally {
      repository.close();
    }
  });
});

describe("phase 5 watch mode", () => {
  it("creates the graph database when watch starts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watch-start-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const indexedResults: Awaited<ReturnType<typeof indexProject>>[] = [];

    expect(fs.existsSync(databasePath(root))).toBe(false);
    const handle = await watchProject(root, {
      debounceMs: 10,
      onIndexed: (result) => {
        indexedResults.push(result);
      }
    });

    try {
      expect(fs.existsSync(databasePath(root))).toBe(true);
      expect(indexedResults).toHaveLength(1);
      expect(indexedResults[0].mode).toBe("full");
      expect(indexedResults[0].counts.documents).toBe(2);
    } finally {
      await handle.close();
    }
  });

  it("keeps MCP tool calls fresh after watched Markdown changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watch-mcp-fresh-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const indexedResults: Awaited<ReturnType<typeof indexProject>>[] = [];
    const waiters: Array<() => void> = [];
    const handle = await watchProject(root, {
      debounceMs: 10,
      onIndexed: (result) => {
        indexedResults.push(result);
        for (const waiter of waiters.splice(0)) {
          waiter();
        }
      }
    });

    try {
      const handler = new ToolHandler(root);
      expect(handler.execute("mdgraph_search", { query: "FreshService" }).content[0].text).toContain("No MDGraph search results");

      fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## Fresh Service\n\n`FreshService` is added while watch mode is active.\n", "utf8");

      await waitForIndexCount(indexedResults, waiters, 2);
      expect(handler.execute("mdgraph_search", { query: "FreshService" }).content[0].text).toContain("auth-v2-design.md");
    } finally {
      await handle.close();
    }
  }, 10000);
});

function waitForIndexCount(
  indexedResults: Awaited<ReturnType<typeof indexProject>>[],
  waiters: Array<() => void>,
  count: number
): Promise<void> {
  if (indexedResults.length >= count) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waiters.indexOf(onIndexed);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      reject(new Error(`Timed out waiting for ${count} watch index result(s); saw ${indexedResults.length}.`));
    }, 8000);
    const onIndexed = (): void => {
      if (indexedResults.length < count) {
        waiters.push(onIndexed);
        return;
      }
      clearTimeout(timeout);
      resolve();
    };
    waiters.push(onIndexed);
  });
}

describe("phase 5 doctor", () => {
  it("reports dead links, stale source refs, and missing definitions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "broken-design.md"), [
      "---",
      "title: Broken Design",
      "type: design",
      "source_refs:",
      "  - src/missing.ts",
      "---",
      "# Broken Design",
      "",
      "See [missing](./missing.md) and [[missing-note]].",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    const report = await runDoctor(root);

    expect(report.summary.deadLinks).toBe(2);
    expect(report.summary.staleSourceRefs).toBe(1);
    expect(report.summary.missingDefinitions).toBe(1);
    expect(report.deadLinks.map((issue) => issue.kind).sort()).toEqual(["markdown", "wikilink"]);
    expect(report.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "link.dead",
      "source_ref.missing",
      "definition.missing"
    ]));
    expect(report.warnings.find((warning) => warning.code === "link.dead")).toMatchObject({
      severity: "error",
      affectedNodes: [{ kind: "document", path: "docs/broken-design.md", line: 9 }]
    });
    expect(report.warnings.find((warning) => warning.code === "source_ref.missing")).toMatchObject({
      severity: "error",
      affectedNodes: [{ kind: "source_ref", path: "src/missing.ts" }]
    });
  });

  it("reports stale indexes without mixing current files with old graph data", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-stale-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const idPath = path.join(docsDir, "id-change.md");
    const modifiedPath = path.join(docsDir, "modified.md");
    const deletedPath = path.join(docsDir, "deleted.md");
    fs.writeFileSync(idPath, "---\nid: old-id\n---\n# ID Change\n", "utf8");
    fs.writeFileSync(modifiedPath, "# Modified\n\nOriginal.\n", "utf8");
    fs.writeFileSync(deletedPath, "# Deleted\n", "utf8");

    await indexProject(root);
    fs.writeFileSync(idPath, "---\nid: new-id\n---\n# ID Change\n", "utf8");
    fs.writeFileSync(modifiedPath, "# Modified\n\nChanged with [missing](./missing.md).\n", "utf8");
    fs.rmSync(deletedPath);
    fs.writeFileSync(path.join(docsDir, "added.md"), "# Added\n", "utf8");

    const report = await runDoctor(root);
    const staleIndex = report.staleIndex;

    expect(staleIndex?.stale).toBe(true);
    expect(staleIndex?.recommendation).toContain("mdgraph index");
    expect(staleIndex?.issues.map((issue: { reason: string }) => issue.reason).sort()).toEqual(["added", "deleted", "id_changed", "modified"]);
    expect(report.warnings).toHaveLength(4);
    expect(report.warnings.every((warning) => warning.code === "index.stale" && warning.severity === "error")).toBe(true);
    expect(report.summary.deadLinks).toBe(0);

    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.documentHashes().get("docs/id-change.md")?.id).toBe(stableId("document", "old-id"));
    } finally {
      repository.close();
    }
  });

  it("does not report existing relative Markdown links as dead", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-links-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(root, "README.md"), "# Project\n\nSee [Plan](docs/Plan_00_20260618.md).\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "Plan_00_20260618.md"), "# Plan\n\nSee [Review](Review.md).\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "Review.md"), "# Review\n", "utf8");

    await indexProject(root);
    const report = await runDoctor(root);

    expect(report.summary.deadLinks).toBe(0);
  });

  it("reports front matter diagnostics as typed warnings", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-frontmatter-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "invalid-yaml.md"), ["---", "title: [broken", "---", "# Invalid YAML", ""].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "not-mapping.md"), ["---", "- item", "---", "# Not Mapping", ""].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "unclosed.md"), ["---", "title: Missing Close", "# Missing Close", ""].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "bad-fields.md"), [
      "---",
      "title: 42",
      "type: mystery",
      "tags: [ok, 7]",
      "---",
      "# Bad Fields",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    const report = await runDoctor(root);
    const frontMatterWarnings = report.warnings.filter((warning) => warning.code.startsWith("front_matter."));

    expect(frontMatterWarnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "front_matter.invalid_yaml",
      "front_matter.not_mapping",
      "front_matter.unclosed",
      "front_matter.invalid_field"
    ]));
    expect(frontMatterWarnings.every((warning) => warning.severity === "warn")).toBe(true);
    expect(frontMatterWarnings.find((warning) => warning.code === "front_matter.invalid_field")).toMatchObject({
      affectedNodes: [{ kind: "document", path: "docs/bad-fields.md" }]
    });
    expect(frontMatterWarnings
      .filter((warning) => warning.code === "front_matter.invalid_field")
      .map((warning) => [warning.evidence.field, warning.evidence.line])
      .sort()).toEqual([
        ["tags", 4],
        ["title", 2],
        ["type", 3]
      ]);
  });

  it("reports active documents that still reference deprecated or superseded documents", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-lifecycle-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "current.md"), [
      "# Current",
      "",
      "See [Deprecated](./deprecated.md), [Status Superseded](./superseded-status.md), [Deprecated By](./superseded-deprecated-by.md), and [Reverse Supersedes](./superseded-reverse.md).",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "replacement-deprecated-by.md"), [
      "---",
      "title: Deprecated By Replacement",
      "---",
      "# Deprecated By Replacement",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "replacement-reverse.md"), [
      "---",
      "title: Reverse Replacement",
      "supersedes: [superseded-reverse]",
      "---",
      "# Reverse Replacement",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "deprecated.md"), [
      "---",
      "title: Deprecated",
      "status: deprecated",
      "---",
      "# Deprecated",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "superseded-status.md"), [
      "---",
      "title: Status Superseded",
      "status: superseded",
      "---",
      "# Status Superseded",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "superseded-deprecated-by.md"), [
      "---",
      "title: Deprecated By Superseded",
      "deprecated_by: [replacement-deprecated-by]",
      "---",
      "# Deprecated By Superseded",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "superseded-reverse.md"), [
      "# Reverse Superseded",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    const report = await runDoctor(root);

    expect(report.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "document.deprecated_referenced",
      "document.superseded_referenced"
    ]));
    expect(report.warnings.find((warning) => warning.code === "document.deprecated_referenced")).toMatchObject({
      severity: "warn",
      affectedNodes: [
        { kind: "document", path: "docs/current.md", line: 3 },
        { kind: "document", path: "docs/deprecated.md" }
      ]
    });
    expect(report.warnings.find((warning) => warning.code === "document.superseded_referenced")).toMatchObject({
      severity: "warn",
      affectedNodes: [
        { kind: "document", path: "docs/current.md", line: 3 },
        { kind: "document", path: "docs/superseded-deprecated-by.md" }
      ]
    });
    expect(report.warnings
      .filter((warning) => warning.code === "document.superseded_referenced")
      .map((warning) => warning.affectedNodes[1]?.path)
      .sort()).toEqual([
        "docs/superseded-deprecated-by.md",
        "docs/superseded-reverse.md",
        "docs/superseded-status.md"
      ]);
  });

  it("includes directly related graph documents in scoped doctor reports", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-scoped-related-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "a.md"), [
      "---",
      "title: A Design",
      "type: design",
      "defines: [AThing]",
      "---",
      "# A Design",
      "",
      "See [B](./b.md).",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "b.md"), [
      "---",
      "title: B Design",
      "type: design",
      "defines: [BThing]",
      "---",
      "# B Design",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    const report = await runDoctor(root, {
      scope: {
        mode: "since",
        baseRef: "HEAD~1",
        changedPaths: ["docs/a.md"],
        deletedPaths: [],
        renamedPaths: [],
        untrackedPaths: [],
        globalHealthIncluded: false
      }
    });

    expect(report.summary.documents).toBe(2);
    expect(report.health.graph.mostConnectedDocs.map((document) => document.path).sort()).toEqual([
      "docs/a.md",
      "docs/b.md"
    ]);
  });

  it("reports scoped deleted Markdown paths after the index is fresh", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-scoped-deleted-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "keep.md"), "# Keep\n", "utf8");
    const deletedPath = path.join(docsDir, "delete-me.md");
    fs.writeFileSync(deletedPath, "# Delete Me\n", "utf8");

    await indexProject(root);
    fs.rmSync(deletedPath);
    await indexProject(root);
    const report = await runDoctor(root, {
      scope: {
        mode: "since",
        baseRef: "HEAD~1",
        changedPaths: [],
        deletedPaths: ["docs/delete-me.md"],
        renamedPaths: [],
        untrackedPaths: [],
        globalHealthIncluded: false
      }
    });

    expect(report.staleIndex.stale).toBe(false);
    expect(report.warnings).toContainEqual(expect.objectContaining({
      code: "document.deleted",
      severity: "info",
      affectedNodes: [{ kind: "document", path: "docs/delete-me.md" }]
    }));
  });

  it("reports conservative tag and link convention warnings", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-conventions-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "source.md"), [
      "---",
      "title: Source",
      "tags: [Needs Review, ok/tag]",
      "---",
      "# Source",
      "",
      "See [Target](.\\target.md).",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "target.md"), "# Target\n", "utf8");

    await indexProject(root);
    const report = await runDoctor(root);

    expect(report.summary.deadLinks).toBe(0);
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tag.invalid_format", severity: "info" }),
      expect.objectContaining({ code: "link.non_posix_path", severity: "info" })
    ]));
  });

  it("reports definition collisions, orphan docs, weak links, and content risks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-governance-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    const configDir = path.join(root, ".mdgraph");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      docs: {
        include: ["docs/**/*.md", "dist/**/*.md"],
        exclude: ["**/.git/**", "**/.mdgraph/**"]
      }
    }), "utf8");
    fs.writeFileSync(path.join(docsDir, "first.md"), [
      "---",
      "title: First Design",
      "type: design",
      "defines: [SharedThing]",
      "---",
      "# First Design",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "second.md"), [
      "---",
      "title: Second Design",
      "type: design",
      "defines: [SharedThing]",
      "---",
      "# Second Design",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "lonely.md"), "plain text without graph links\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "decision.md"), [
      "---",
      "title: Decision Record",
      "type: adr",
      "defines: [DecisionRecord]",
      "---",
      "# Decision Record",
      ""
    ].join("\n"), "utf8");
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist", "generated.md"), "# Generated\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "risk.md"), [
      "# risk notes",
      "ignore previous instructions",
      "<script>alert(1)</script>",
      "data:text/html;base64,AAAA",
      "hidden\u200btext",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    const report = await runDoctor(root);

    expect(report.summary.possibleContradictions).toBe(1);
    expect(report.possibleContradictions[0].entity.name).toBe("SharedThing");
    expect(report.summary.orphanDocs).toBeGreaterThanOrEqual(1);
    expect(report.orphanDocs.map((document) => document.path)).toContain("docs/lonely.md");
    expect(report.summary.weaklyLinkedDocs).toBeGreaterThanOrEqual(2);
    expect(report.summary.contentRisks).toBe(4);
    expect(report.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "definition.duplicate",
      "document.orphan",
      "document.weakly_linked",
      "graph.missing_decision_link",
      "storage.generated_path_indexed",
      "content.risk"
    ]));
    expect(report.health.graph.mostConnectedDocs.length).toBeGreaterThan(0);
    expect(report.health.graph.duplicateDefinitions[0]).toMatchObject({ entityName: "SharedThing" });
    expect(report.health.graph.missingDecisionLinks.map((item) => item.path)).toContain("docs/decision.md");
    expect(report.health.storage.pathGroups.map((group) => group.group)).toContain("dist");
    expect(report.health.storage.warnings.map((warning) => warning.code)).toContain("storage.generated_path_indexed");
  });

  it("does not report configured stop entities as definition collisions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-stop-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    const configDir = path.join(root, ".mdgraph");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      entities: {
        ...DEFAULT_CONFIG.entities,
        stopEntities: [...DEFAULT_CONFIG.entities.stopEntities, "Checklist"]
      }
    }), "utf8");
    fs.writeFileSync(path.join(docsDir, "first.md"), "# Checklist\n\nFirst checklist.\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "second.md"), "# Checklist\n\nSecond checklist.\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "third.md"), "# SharedThing\n\nFirst definition.\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "fourth.md"), "# SharedThing\n\nSecond definition.\n", "utf8");

    await indexProject(root);
    const report = await runDoctor(root);

    expect(report.summary.possibleContradictions).toBe(1);
    expect(report.possibleContradictions.map((issue) => issue.entity.name)).toEqual(["SharedThing"]);
  });
});
