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

  it("reports definition collisions, orphan docs, weak links, and content risks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-doctor-governance-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
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
