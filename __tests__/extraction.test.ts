import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/load-config.js";
import { extractEntities } from "../src/extraction/entity-extractor.js";
import { parseMarkdownDocument } from "../src/parser/markdown-parser.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("extractEntities", () => {
  it("extracts high-confidence entities without promoting generic prose symbols", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-extraction-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "auth.md");
    fs.writeFileSync(file, [
      "---",
      "title: Auth Design",
      "defines: [AuthService]",
      "---",
      "# Auth Design",
      "",
      "Service appears as ordinary prose and should not become a strong entity.",
      "",
      "## Defines",
      "",
      "- `RedisTimeoutError`: timeout from Redis.",
      "",
      "## Runtime",
      "",
      "The route `GET /api/auth/login` calls `AuthService` and handles `RedisTimeoutError`.",
      "Set `JWT_SECRET` and check `src/auth/session.ts`.",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);
    const entities = extractEntities(parsed, DEFAULT_CONFIG);
    const labels = entities.map((entity) => `${entity.role}:${entity.kind}:${entity.name}`);

    expect(labels).toContain("definition:symbol:AuthService");
    expect(labels).toContain("definition:error_code:RedisTimeoutError");
    expect(labels).toContain("reference:api_route:GET /api/auth/login");
    expect(labels).toContain("reference:config_key:JWT_SECRET");
    expect(labels).toContain("reference:file_path:src/auth/session.ts");
    expect(labels).not.toContain("reference:symbol:Service");
  });

  it("filters configured stop entities and broad prose PascalCase from ordinary text", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-extraction-stop-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "noise.md");
    fs.writeFileSync(file, [
      "# Noise",
      "",
      "Config Error Service API User Data appear as ordinary prose.",
      "The ParserThing and AuthCoordinator words are prose-only and should stay in FTS, not graph references.",
      "Inline code still references `AuthCoordinator` when written as code.",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);
    const entities = extractEntities(parsed, DEFAULT_CONFIG);
    const labels = entities.map((entity) => `${entity.role}:${entity.kind}:${entity.name}`);

    for (const stopEntity of DEFAULT_CONFIG.entities.stopEntities) {
      expect(labels).not.toContain(`reference:symbol:${stopEntity}`);
    }
    expect(labels).not.toContain("reference:symbol:ParserThing");
    expect(labels).toContain("reference:symbol:AuthCoordinator");
  });
});
