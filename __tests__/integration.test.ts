import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildContext } from "../src/query/context-builder.js";
import { searchGraph } from "../src/query/search.js";
import { traceNodes } from "../src/query/trace.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("MDGraph integration", () => {
  it("indexes documents and answers search, context, source-ref, and trace queries", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-integration-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const indexResult = await indexProject(root);
    expect(indexResult.files).toBe(3);
    expect(indexResult.counts.documents).toBe(3);
    expect(indexResult.counts.entities).toBeGreaterThanOrEqual(3);
    expect(indexResult.counts.sourceRefs).toBe(2);
    expect(indexResult.counts.edges).toBeGreaterThanOrEqual(8);

    const db = openDatabase(root);
    const repository = new GraphRepository(db);
    try {
      const config = loadConfig(root);
      const searchResults = searchGraph(repository, config, "AuthService", 5);
      expect(searchResults[0].document.path).toBe("docs/auth-v2-design.md");
      expect(searchResults[0].reason).toContain("definition");

      const context = buildContext(repository, config, "why does RedisTimeoutError affect login");
      expect(context.items.some((item) => item.path === "docs/redis-cache-design.md")).toBe(true);
      expect(context.items.some((item) => item.reason.length > 0)).toBe(true);

      const authNode = repository.resolveNode("AuthService");
      expect(authNode?.kind).toBe("entity");
      const sourceNode = repository.resolveNode("src/auth/AuthService.ts");
      expect(sourceNode?.kind).toBe("source_ref");

      const trace = traceNodes(repository, "AuthService", "RedisTimeoutError", 6);
      expect(trace.found).toBe(true);

      const dependencyTrace = traceNodes(repository, "AuthService", "Redis Cache Design", 6);
      expect(dependencyTrace.found).toBe(true);
      expect(dependencyTrace.steps.map((step) => step.edgeKind)).toContain("DEPENDS_ON");
    } finally {
      repository.close();
    }
  });
});

function createFixtureDocs(root: string): void {
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(path.join(docsDir, "redis-cache-design.md"), [
    "---",
    "id: redis-cache-design",
    "title: Redis Cache Design",
    "type: design",
    "defines:",
    "  - RedisTimeoutError",
    "source_refs:",
    "  - src/cache/redis.ts",
    "---",
    "# Redis Cache Design",
    "",
    "## Defines",
    "",
    "- `RedisTimeoutError`: Redis timeout surfaced to callers.",
    "",
    "## Timeout Handling",
    "",
    "The `RedisTimeoutError` path should fail closed.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "auth-v2-design.md"), [
    "---",
    "id: auth-v2-design",
    "title: Auth v2 Design",
    "type: design",
    "defines:",
    "  - AuthService",
    "depends_on:",
    "  - redis-cache-design",
    "implements:",
    "  - src/auth/AuthService.ts",
    "---",
    "# Auth v2 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthService` depends on Redis cache behavior and handles `RedisTimeoutError`.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "login-flow.md"), [
    "---",
    "id: login-flow",
    "title: Login Flow",
    "type: spec",
    "---",
    "# Login Flow",
    "",
    "The `GET /api/auth/login` route uses `AuthService`.",
    "When `RedisTimeoutError` occurs, the login flow returns a retryable error.",
    "See [[auth-v2-design#session-refresh]].",
    ""
  ].join("\n"), "utf8");
}