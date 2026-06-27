import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { parseMarkdownDocument } from "../src/parser/markdown-parser.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("parseMarkdownDocument", () => {
  it("extracts front matter, sections, markdown links, wikilinks, and code snippets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "auth-v2-design.md");
    fs.writeFileSync(file, [
      "---",
      "id: auth-v2-design",
      "title: Auth v2 Design",
      "type: design",
      "defines:",
      "  - AuthService",
      "source_refs:",
      "  - src/auth/AuthService.ts",
      "---",
      "# Auth v2 Design",
      "",
      "See [Redis](./redis-cache-design.md#timeout-handling) and [[login-flow#error-path|Login Flow]].",
      "",
      "## Session Refresh",
      "",
      "The service uses `AuthService`.",
      "",
      "```bash",
      "npm run build",
      "```",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);

    expect(parsed.relativePath).toBe("docs/auth-v2-design.md");
    expect(parsed.title).toBe("Auth v2 Design");
    expect(parsed.frontmatter.defines).toEqual(["AuthService"]);
    expect(parsed.sections[0]?.startLine).toBe(10);
    expect(parsed.sections.map((section) => section.heading)).toContain("Session Refresh");
    expect(parsed.markdownLinks[0]).toMatchObject({ text: "Redis", url: "./redis-cache-design.md#timeout-handling" });
    expect(parsed.wikiLinks[0]).toMatchObject({ target: "login-flow", anchor: "error-path", alias: "Login Flow" });
    expect(parsed.inlineCode[0]).toMatchObject({ value: "AuthService" });
    expect(parsed.codeBlocks[0]).toMatchObject({ language: "bash", value: "npm run build" });
  });

  it("ignores WikiLinks inside fenced code blocks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-code-wikilink-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "links.md");
    fs.writeFileSync(file, [
      "# Links",
      "",
      "```md",
      "[[example-only]]",
      "```",
      "",
      "See [[real-target]].",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);

    expect(parsed.wikiLinks.map((link) => link.target)).toEqual(["real-target"]);
  });

  it("ignores WikiLinks inside inline code spans while keeping prose WikiLinks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-inline-wikilink-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "links.md");
    fs.writeFileSync(file, [
      "# Links",
      "",
      "Use `[[example-only]]` as a literal, then see [[real-target]].",
      "A second `prefix [[also-example]] suffix` should stay code.",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);

    expect(parsed.wikiLinks.map((link) => link.target)).toEqual(["real-target"]);
  });

  it("keeps parent section content bounded before child headings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-section-boundary-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "sections.md");
    fs.writeFileSync(file, [
      "# Root",
      "Root intro.",
      "",
      "## Child",
      "Child detail.",
      "",
      "## Sibling",
      "Sibling detail.",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);
    const rootSection = parsed.sections.find((section) => section.heading === "Root");
    const childSection = parsed.sections.find((section) => section.heading === "Child");

    expect(rootSection?.content).toContain("Root intro.");
    expect(rootSection?.content).not.toContain("Child detail.");
    expect(childSection?.content).toContain("Child detail.");
    expect(childSection?.content).not.toContain("Sibling detail.");
  });

  it("falls back to Markdown content when YAML front matter is invalid", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-invalid-yaml-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "broken.md");
    fs.writeFileSync(file, ["---", "title: [broken", "---", "# Broken", ""].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);

    expect(parsed.title).toBe("Broken");
    expect(parsed.frontmatter.title).toBeUndefined();
    expect(parsed.frontmatterDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "front_matter.invalid_yaml", line: 2 })
    ]));
    expect(parsed.sections[0]).toMatchObject({ heading: "Broken", startLine: 4 });
  });

  it("reports front matter diagnostics without blocking parsing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-frontmatter-diagnostics-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    const arrayFile = path.join(docsDir, "array.md");
    fs.writeFileSync(arrayFile, ["---", "- not", "- mapping", "---", "# Array", ""].join("\n"), "utf8");
    expect(parseMarkdownDocument(root, arrayFile).frontmatterDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "front_matter.not_mapping", line: 2 })
    ]));

    const unclosedFile = path.join(docsDir, "unclosed.md");
    fs.writeFileSync(unclosedFile, ["---", "title: Missing Close", "# Missing Close", ""].join("\n"), "utf8");
    expect(parseMarkdownDocument(root, unclosedFile).frontmatterDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "front_matter.unclosed", line: 1 })
    ]));

    const fieldsFile = path.join(docsDir, "fields.md");
    fs.writeFileSync(fieldsFile, [
      "---",
      "title: 42",
      "type: unknown-kind",
      "tags: [docs, 7]",
      "trust_tier: maybe",
      "---",
      "# Fields",
      ""
    ].join("\n"), "utf8");
    const diagnostics = parseMarkdownDocument(root, fieldsFile).frontmatterDiagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["front_matter.invalid_field"]));
    expect(diagnostics.map((diagnostic) => diagnostic.field).sort()).toEqual(["tags", "title", "trust_tier", "type"]);
    expect(diagnostics.map((diagnostic) => [diagnostic.field, diagnostic.line]).sort()).toEqual([
      ["tags", 4],
      ["title", 2],
      ["trust_tier", 5],
      ["type", 3]
    ]);
  });

  it("keeps section ids stable when leading lines are inserted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-stable-sections-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "sections.md");
    fs.writeFileSync(file, [
      "# Title",
      "",
      "## Runtime",
      "Runtime content.",
      "",
      "## Runtime",
      "Second runtime content.",
      ""
    ].join("\n"), "utf8");
    const before = parseMarkdownDocument(root, file).sections.map((section) => section.id);

    fs.writeFileSync(file, [
      "Intro line.",
      "",
      "# Title",
      "",
      "## Runtime",
      "Runtime content.",
      "",
      "## Runtime",
      "Second runtime content.",
      ""
    ].join("\n"), "utf8");
    const after = parseMarkdownDocument(root, file).sections.map((section) => section.id);

    expect(after).toEqual(before);
  });

  it("rejects Markdown ASTs beyond parser budgets without crashing indexing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-parser-budget-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const badFile = path.join(docsDir, "too-many-nodes.md");
    const goodFile = path.join(docsDir, "ok.md");
    fs.writeFileSync(badFile, Array.from({ length: 10_001 }, () => "#").join("\n"), "utf8");
    fs.writeFileSync(goodFile, "# OK\n", "utf8");

    expect(() => parseMarkdownDocument(root, badFile)).toThrow(/Markdown AST exceeds .* budget/);

    const result = await indexProject(root);
    expect(result.skipped).toBe(1);
    expect(result.skippedFiles[0]).toMatchObject({ path: "docs/too-many-nodes.md" });
    expect(result.counts.documents).toBe(1);
  });
});
