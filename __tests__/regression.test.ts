import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config/load-config.js";
import { openDatabase, openExistingDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildContext } from "../src/query/context-builder.js";
import { explainSearchGraph, searchGraph } from "../src/query/search.js";
import { traceNodes } from "../src/query/trace.js";
import type { MDGraphConfig } from "../src/types.js";
import { stableId } from "../src/utils/id.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("regression coverage", () => {
  it("preserves inbound document links when only the target document changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-inbound-edge-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "a.md"), "# A\n\nSee [B](./b.md).\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "b.md"), "# B\n\nInitial.\n", "utf8");

    await indexProject(root);
    expect(countEdges(root, "LINKS_TO")).toBe(1);

    fs.appendFileSync(path.join(docsDir, "b.md"), "\nMore detail.\n", "utf8");
    await indexProject(root);
    expect(countEdges(root, "LINKS_TO")).toBe(1);

    fs.rmSync(path.join(docsDir, "b.md"));
    await indexProject(root);
    expect(countEdges(root, "LINKS_TO")).toBe(0);
  });

  it("replaces the old document id when frontmatter id changes on the same path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-id-change-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const docPath = path.join(docsDir, "design.md");
    fs.writeFileSync(docPath, [
      "---",
      "id: old-design",
      "title: Design",
      "defines: [OldEntity]",
      "---",
      "# Design",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    fs.writeFileSync(docPath, [
      "---",
      "id: new-design",
      "title: Design",
      "defines: [NewEntity]",
      "---",
      "# Design",
      ""
    ].join("\n"), "utf8");

    const result = await indexProject(root);
    expect(result.changed).toBe(1);

    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.getNode(stableId("document", "old-design"))).toBeUndefined();
      expect(repository.getNode(stableId("document", "new-design"))?.kind).toBe("document");
      expect(repository.resolveNode("OldEntity")).toBeUndefined();
      expect(repository.resolveNode("NewEntity")?.kind).toBe("entity");
    } finally {
      repository.close();
    }
  });

  it("does not pass unsafe hyphenated input directly to FTS5", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-fts-special-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const results = searchGraph(repository, config, "auth-v2", 5);
      expect(results.some((result) => result.document.path.endsWith("auth-v2-design.md"))).toBe(true);
      expect(() => searchGraph(repository, config, "redis.lock.ttl AUTH-401", 5)).not.toThrow();
      expect(() => searchGraph(repository, config, "documents do not link or reference AuthService", 5)).not.toThrow();
      expect(() => searchGraph(repository, config, "which docs mention AUTH_RETRY_LIMIT or source_refs", 5)).not.toThrow();
    } finally {
      repository.close();
    }
  });

  it("migrates legacy chunk FTS tables to external-content storage", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-fts-migration-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const legacyDb = openDatabase(root);
    try {
      legacyDb.exec(`
        DROP TABLE chunks_fts;
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          content,
          document_id UNINDEXED,
          section_id UNINDEXED,
          chunk_id UNINDEXED,
          tokenize = 'unicode61'
        );
        INSERT INTO chunks_fts (content, document_id, section_id, chunk_id)
        SELECT content, document_id, section_id, id FROM chunks;
      `);
    } finally {
      legacyDb.close();
    }

    const migratedDb = openExistingDatabase(root);
    try {
      const ftsSchema = migratedDb.prepare("SELECT sql FROM sqlite_schema WHERE name = 'chunks_fts'").get() as { sql: string };
      const contentTables = migratedDb.prepare("SELECT name FROM sqlite_schema WHERE name = 'chunks_fts_content'").all();
      const rows = migratedDb.prepare(`
        SELECT c.id
        FROM chunks_fts
        JOIN chunks c ON c.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
      `).all("authservice");

      expect(ftsSchema.sql).toMatch(/content\s*=\s*'chunks'/i);
      expect(ftsSchema.sql).toMatch(/content_rowid\s*=\s*'rowid'/i);
      expect(contentTables).toHaveLength(0);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      migratedDb.close();
    }
  });

  it("removes external FTS terms when a document is deleted incrementally", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-fts-delete-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const docPath = path.join(docsDir, "doomed.md");
    fs.writeFileSync(docPath, "# Doomed\n\nUniqueGoneToken appears only here.\n", "utf8");

    await indexProject(root);
    expect(ftsMatchCount(root, "uniquegonetoken")).toBe(1);

    fs.rmSync(docPath);
    await indexProject(root);

    expect(ftsMatchCount(root, "uniquegonetoken")).toBe(0);
  });

  it("keeps context content inside small character budgets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-budget-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, maxContextChars: 80 }
      };
      const context = buildContext(repository, config, "AuthService RedisTimeoutError");
      const debugContext = buildContext(repository, config, "AuthService RedisTimeoutError", { debug: true });
      expect(context.usedChars).toBeLessThanOrEqual(context.maxChars);
      expect(context.items.length).toBeGreaterThan(0);
      expect(context.items.reduce((sum, item) => sum + item.content.length, 0)).toBe(context.usedChars);
      expect(debugContext.debug?.budgetTruncatedItems).toBeGreaterThan(0);
    } finally {
      repository.close();
    }
  });

  it("uses known files as context seeds for task-start briefs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-known-files-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const context = buildContext(repository, DEFAULT_CONFIG, "unrelated task text", {
        knownFiles: ["src/auth/AuthService.ts"],
        maxChars: 120
      });

      expect(context.maxChars).toBe(120);
      expect(context.usedChars).toBeLessThanOrEqual(120);
      expect(context.knownFiles).toEqual(["src/auth/AuthService.ts"]);
      expect(context.items.some((item) => item.path === "docs/auth-v2-design.md")).toBe(true);
      expect(context.suggestedNextQueries?.some((query) => query.includes("src/auth/AuthService.ts"))).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("orders context across documents before repeating sections from one document", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-diversity-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "alpha.md"), [
      "# Alpha",
      "",
      "## First",
      "",
      "`SharedSignal` appears in the first Alpha section.",
      "",
      "## Second",
      "",
      "`SharedSignal` appears in the second Alpha section.",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "beta.md"), [
      "# Beta",
      "",
      "## Only",
      "",
      "`SharedSignal` appears in the Beta section.",
      ""
    ].join("\n"), "utf8");
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, defaultLimit: 4 }
      };
      const context = buildContext(repository, config, "SharedSignal");
      const firstTwoPaths = context.items.slice(0, 2).map((item) => item.path);
      const sectionKeys = context.items.map((item) => `${item.path}#${item.heading ?? ""}`);

      expect(new Set(firstTwoPaths)).toEqual(new Set(["docs/alpha.md", "docs/beta.md"]));
      expect(new Set(sectionKeys).size).toBe(sectionKeys.length);
      expect(context.items.every((item) => item.reason.length > 0)).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("reports context graph expansion fanout caps", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-fanout-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "hub.md"), [
      "---",
      "id: hub",
      "title: Hub",
      "defines: [HubThing]",
      "depends_on:",
      ...Array.from({ length: 20 }, (_, index) => `  - leaf-${index + 1}`),
      "---",
      "# Hub",
      "",
      "`HubThing` fans out to many leaves.",
      ""
    ].join("\n"), "utf8");
    for (let index = 1; index <= 20; index += 1) {
      fs.writeFileSync(path.join(docsDir, `leaf-${index}.md`), [
        "---",
        `id: leaf-${index}`,
        `title: Leaf ${index}`,
        "---",
        `# Leaf ${index}`,
        "",
        `Leaf ${index} documents one dependency.`,
        ""
      ].join("\n"), "utf8");
    }
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, defaultLimit: 1 }
      };
      const context = buildContext(repository, config, "HubThing", { debug: true });

      expect(context.debug?.expandedEdges).toBeGreaterThan(0);
      expect(context.debug?.skippedByNodeLimit).toBeGreaterThan(0);
      expect(context.debug?.visitedNodes).toBeGreaterThanOrEqual(context.debug?.seedNodes ?? 0);
    } finally {
      repository.close();
    }
  });

  it("includes graph-expanded dependency context with an explanatory path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-expansion-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const context = buildContext(repository, DEFAULT_CONFIG, "AuthService");
      const debugContext = buildContext(repository, DEFAULT_CONFIG, "AuthService", { debug: true });
      const direct = context.items.find((item) => item.path === "docs/auth-v2-design.md" && !item.reason.includes("graph expansion"));
      const dependency = context.items.find((item) => item.path === "docs/redis-cache-design.md");
      const firstExpandedIndex = context.items.findIndex((item) => item.reason.includes("graph expansion"));
      const lastDirectIndex = context.items.reduce(
        (lastIndex, item, index) => item.reason.includes("graph expansion") ? lastIndex : index,
        -1
      );

      expect(direct?.nodeId).toMatch(/^(document|section):/);
      expect(direct?.documentId).toMatch(/^document:/);
      if (direct?.sectionId) {
        expect(direct.sectionId).toBe(direct.nodeId);
        expect(direct.anchor).toBeTruthy();
      }
      expect(dependency).toBeDefined();
      expect(dependency?.nodeId).toMatch(/^section:/);
      expect(dependency?.documentId).toMatch(/^document:/);
      expect(dependency?.sectionId).toBe(dependency?.nodeId);
      expect(dependency?.anchor).toBeTruthy();
      expect(dependency?.reason).toContain("graph expansion");
      expect(dependency?.reason).toContain("DEPENDS_ON");
      expect(dependency?.edgePath?.some((step) => step.edgeKind === "DEPENDS_ON" && step.provenance === "frontmatter")).toBe(true);
      expect(firstExpandedIndex).toBeGreaterThan(lastDirectIndex);
      expect(context.debug).toBeUndefined();
      expect(debugContext.debug?.seedNodes).toBeGreaterThan(0);
      expect(debugContext.debug?.visitedNodes).toBeGreaterThanOrEqual(debugContext.debug?.seedNodes ?? 0);
      expect(debugContext.debug?.candidateCount).toBe(debugContext.debug?.directCandidates + debugContext.debug?.expandedCandidates);
    } finally {
      repository.close();
    }
  });

  it("explains search query parsing and ranking inputs without changing results", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-search-explain-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const results = searchGraph(repository, config, "AuthService RedisTimeoutError", 5);
      const explanation = explainSearchGraph(repository, config, "AuthService RedisTimeoutError", 5);

      expect(explanation.query).toBe("AuthService RedisTimeoutError");
      expect(explanation.ftsQuery).toContain("authservice*");
      expect(explanation.entityCandidates).toContain("AuthService");
      expect(explanation.matchedEntities.map((entity) => entity.name)).toContain("AuthService");
      expect(explanation.queryMode).toBe("auto");
      expect(explanation.ranking.fusion).toBe("rrf");
      expect(explanation.ranking.channels).toEqual(expect.arrayContaining(["definition", "fts"]));
      expect(explanation.results.map((result) => result.document.path)).toEqual(results.map((result) => result.document.path));
      expect(explanation.results.every((result) => result.reason.length > 0)).toBe(true);
      expect(explanation.results.every((result) => result.reason.includes("RRF fusion"))).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("down-ranks high-frequency entity matches according to the configured threshold", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-high-frequency-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    for (const name of ["one", "two", "three"]) {
      fs.writeFileSync(path.join(docsDir, `${name}.md`), `# ${name}\n\n\`CommonThing\` appears here.\n`, "utf8");
    }
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const highThreshold: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, highFrequencyEntityThreshold: 10 }
      };
      const lowThreshold: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, highFrequencyEntityThreshold: 1 }
      };
      const unpenalized = searchGraph(repository, highThreshold, "CommonThing", 1);
      const penalized = searchGraph(repository, lowThreshold, "CommonThing", 1);

      expect(penalized[0].score).toBeLessThan(unpenalized[0].score);
      expect(penalized[0].reason).toContain("down-ranked high-frequency entity match");
    } finally {
      repository.close();
    }
  });

  it("applies trust tier and status ranking adjustments to otherwise similar definition matches", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-ranking-adjustments-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "validated.md"), [
      "---",
      "id: validated-rank-signal",
      "title: Validated Rank Signal",
      "type: design",
      "trust_tier: validated",
      "defines: [RankSignal]",
      "---",
      "# Validated Rank Signal",
      "",
      "## Defines",
      "",
      "`RankSignal` is defined here."
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "authored.md"), [
      "---",
      "id: authored-rank-signal",
      "title: Authored Rank Signal",
      "type: design",
      "trust_tier: authored",
      "defines: [RankSignal]",
      "---",
      "# Authored Rank Signal",
      "",
      "## Defines",
      "",
      "`RankSignal` is defined here."
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(docsDir, "deprecated.md"), [
      "---",
      "id: deprecated-rank-signal",
      "title: Deprecated Rank Signal",
      "type: design",
      "status: deprecated",
      "trust_tier: authored",
      "defines: [RankSignal]",
      "---",
      "# Deprecated Rank Signal",
      "",
      "## Defines",
      "",
      "`RankSignal` is defined here."
    ].join("\n"), "utf8");

    await indexProject(root);
    const repository = new GraphRepository(openDatabase(root));
    try {
      const results = searchGraph(repository, loadConfig(root), "RankSignal", 3);
      const byPath = new Map(results.map((result) => [result.document.path, result.score]));

      expect(results[0].document.path).toBe("docs/validated.md");
      expect(byPath.get("docs/validated.md") ?? 0).toBeGreaterThan(byPath.get("docs/authored.md") ?? 0);
      expect(byPath.get("docs/authored.md") ?? 0).toBeGreaterThan(byPath.get("docs/deprecated.md") ?? 0);
    } finally {
      repository.close();
    }
  });

  it("preserves multiple search explanations when deduping the same section", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-search-dedupe-reasons-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "auth.md"), [
      "# Auth Design",
      "",
      "## Defines",
      "",
      "- `AuthService`: AuthService handles login refresh.",
      ""
    ].join("\n"), "utf8");

    await indexProject(root);
    const repository = new GraphRepository(openDatabase(root));
    try {
      const results = searchGraph(repository, loadConfig(root), "AuthService", 5);
      const authResult = results.find((result) => result.section?.heading === "Defines");

      expect(authResult?.reason).toContain("definition");
      expect(authResult?.reason).toContain("FTS5 content match");
      expect(authResult?.reason).toContain("RRF fusion");
    } finally {
      repository.close();
    }
  });

  it("resolves sections by path anchor and distinguishes ambiguous heading queries", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-repo-node-section-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "one.md"), "# One\n\n## Runtime\nFirst runtime.\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "two.md"), "# Two\n\n## Runtime\nSecond runtime.\n", "utf8");

    await indexProject(root);
    const repository = new GraphRepository(openDatabase(root));
    try {
      const section = repository.resolveNodeDetailed("docs/one.md#runtime");
      const ambiguous = repository.resolveNodeDetailed("Runtime");

      expect(section.status).toBe("found");
      expect(section.node.kind).toBe("section");
      expect(section.node.data.anchor).toBe("runtime");
      expect(ambiguous.status).toBe("ambiguous");
      expect(ambiguous.error).toBe("ambiguous_section");
      expect(ambiguous.candidates.map((candidate: { documentPath: string }) => candidate.documentPath).sort()).toEqual(["docs/one.md", "docs/two.md"]);
    } finally {
      repository.close();
    }
  });

  it("marks reverse traversal in trace steps", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-trace-direction-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const trace = traceNodes(repository, "Redis Cache Design", "AuthService", 6);
      expect(trace.found).toBe(true);
      expect(trace.steps.some((step) => step.edgeKind === "DEPENDS_ON" && step.traversalDirection === "reverse")).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("traces source-ref endpoints and reports max-depth misses", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-trace-source-depth-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const sourceTrace = traceNodes(repository, "AuthService", "src/auth/AuthService.ts", 3);
      const shallowTrace = traceNodes(repository, "AuthService", "RedisTimeoutError", 1);

      expect(sourceTrace.found).toBe(true);
      expect(sourceTrace.steps.map((step) => step.edgeKind)).toContain("IMPLEMENTS");
      expect(shallowTrace.found).toBe(false);
      expect(shallowTrace.message).toContain("trace depth budget");
    } finally {
      repository.close();
    }
  });
});

function countEdges(root: string, kind: string): number {
  const db = openDatabase(root);
  try {
    const row = db.prepare("SELECT count(*) AS count FROM edges WHERE kind = ?").get(kind) as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

function ftsMatchCount(root: string, query: string): number {
  const db = openDatabase(root);
  try {
    const row = db.prepare("SELECT count(*) AS count FROM chunks_fts WHERE chunks_fts MATCH ?").get(query) as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}
