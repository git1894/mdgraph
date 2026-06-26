import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphBundle, sourceSnapshot, verifyGraphBundle } from "../src/bundle/bundle.js";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase, openExistingDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { generateReport } from "../src/reporting/report.js";
import { createAlphaFixtureDocs, createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("v0.6.1 schema metadata", () => {
  it("records current schema metadata and marks missing metadata on existing databases as legacy", async () => {
    const root = makeTempRoot("mdgraph-schema-metadata-");
    createFixtureDocs(root);
    await indexProject(root);

    const current = new GraphRepository(openExistingDatabase(root));
    try {
      expect(current.schemaMetadata().schemaVersion).toBe(1);
      expect(current.schemaMetadata().baseline).toBe("current");
    } finally {
      current.close();
    }

    const db = openDatabase(root);
    try {
      db.exec("DROP TABLE schema_metadata; DROP TABLE schema_migrations;");
    } finally {
      db.close();
    }

    const legacy = new GraphRepository(openExistingDatabase(root));
    try {
      expect(legacy.schemaMetadata().schemaVersion).toBe(1);
      expect(legacy.schemaMetadata().baseline).toBe("legacy");
    } finally {
      legacy.close();
    }
  });

  it("refuses future schema versions before applying schema", async () => {
    const root = makeTempRoot("mdgraph-schema-future-");
    createFixtureDocs(root);
    await indexProject(root);

    const db = openDatabase(root);
    try {
      db.prepare("UPDATE schema_metadata SET value = ? WHERE key = 'schema_version'").run("999");
    } finally {
      db.close();
    }

    expect(() => openExistingDatabase(root)).toThrow(/schema version 999/);
  });
});

describe("v0.6.1 bundle and report", () => {
  it("computes deterministic source hashes without document content", async () => {
    const root = makeTempRoot("mdgraph-source-hash-");
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const docs = repository.allDocuments().map((document) => ({ path: document.path, hash: document.hash })).reverse();
      const first = sourceSnapshot(loadConfig(root), docs);
      const second = sourceSnapshot(loadConfig(root), [...docs].reverse());
      expect(first.sourceHash).toBe(second.sourceHash);
      expect(JSON.stringify(first)).not.toContain("AuthService");
      expect(first.documents.map((document) => document.path)).toEqual([...first.documents.map((document) => document.path)].sort());
    } finally {
      repository.close();
    }
  });

  it("creates and verifies a private directory bundle", async () => {
    const root = makeTempRoot("mdgraph-bundle-");
    createFixtureDocs(root);
    await indexProject(root);

    const created = await createGraphBundle(root);
    expect(fs.existsSync(path.join(created.bundleDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(created.bundleDir, "graph.db"))).toBe(true);
    expect(fs.existsSync(path.join(created.bundleDir, "config.json"))).toBe(true);
    expect(created.manifest.visibility).toBe("private");
    expect(JSON.stringify(created.manifest)).not.toContain(root);

    const verified = verifyGraphBundle(created.bundleDir, { projectRoot: root });
    expect(verified.valid).toBe(true);
    expect(verified.errors).toEqual([]);
    expect(verified.freshness.state).toBe("fresh");
    expect(verified.manifest?.sourceHash).toBe(created.manifest.sourceHash);
  });

  it("reports corrupted bundle artifacts as invalid", async () => {
    const root = makeTempRoot("mdgraph-bundle-corrupt-");
    createFixtureDocs(root);
    await indexProject(root);

    const created = await createGraphBundle(root);
    fs.writeFileSync(path.join(created.bundleDir, "config.json"), "{\"docs\":{\"include\":[\"other/**/*.md\"]}}\n", "utf8");

    const verified = verifyGraphBundle(created.bundleDir, { projectRoot: root });
    expect(verified.valid).toBe(false);
    expect(verified.errors.some((error) => error.includes("configHash"))).toBe(true);
  });

  it("verifies missing bundle databases without creating replacement files", async () => {
    const root = makeTempRoot("mdgraph-bundle-missing-db-");
    createFixtureDocs(root);
    await indexProject(root);

    const created = await createGraphBundle(root);
    const graphPath = path.join(created.bundleDir, "graph.db");
    fs.rmSync(graphPath);

    const verified = verifyGraphBundle(created.bundleDir, { projectRoot: root });
    expect(verified.valid).toBe(false);
    expect(verified.errors).toContain("Missing graph.db.");
    expect(fs.existsSync(graphPath)).toBe(false);
  });

  it("generates a baseline report with eval and bundle summaries", async () => {
    const root = makeTempRoot("mdgraph-report-");
    createAlphaFixtureDocs(root);
    await indexProject(root);
    const created = await createGraphBundle(root);

    const report = await generateReport(root, { eval: true, bundle: created.bundleDir });
    expect(report.indexed).toBe(true);
    expect(report.counts?.documents).toBeGreaterThan(0);
    expect(report.schema?.schemaVersion).toBe(1);
    expect(report.doctor?.summary.documents).toBe(report.counts?.documents);
    expect(report.eval?.summary.cases).toBeGreaterThan(0);
    expect(report.bundle?.valid).toBe(true);
    expect(report.trend.state).toBe("first_run");
  });
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}
