import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, configPath, databasePath, initConfig, loadConfig } from "../src/config/load-config.js";
import { openExistingDatabase } from "../src/db/connection.js";
import { parseMarkdownDocument } from "../src/parser/markdown-parser.js";
import { LinkResolver } from "../src/resolution/link-resolver.js";
import { scanMarkdownFiles } from "../src/scanner/file-scanner.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("configuration loading", () => {
  it("loads defaults, initialized config, and reports invalid JSON with the config path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-config-"));
    tempDirs.push(root);

    expect(loadConfig(root).docs.include).toEqual(DEFAULT_CONFIG.docs.include);
    expect(loadConfig(root).docs.exclude).toContain("**/node_modules/**");
    expect(loadConfig(root).docs.exclude).toContain("**/temp/**");
    expect(loadConfig(root).index.followGitignore).toBe(true);

    const target = initConfig(root, ["notes/**/*.md"]);
    expect(target).toBe(configPath(root));
    expect(loadConfig(root).docs.include).toEqual(["notes/**/*.md"]);

    fs.writeFileSync(target, "{ invalid", "utf8");
    expect(() => loadConfig(root)).toThrow(/Invalid MDGraph config/);
    expect(() => loadConfig(root)).toThrow(target);
    expect(() => loadConfig(root)).toThrow(/mdgraph init/);
  });
});

describe("scanMarkdownFiles", () => {
  it("follows root gitignore by default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-scan-default-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "included.md"), "# Included\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "ignored.md"), "# Ignored but useful\n", "utf8");
    fs.writeFileSync(path.join(root, ".gitignore"), "docs/ignored.md\n", "utf8");

    const files = await scanMarkdownFiles(root, {
      ...DEFAULT_CONFIG,
      docs: { include: ["docs/**/*.md"], exclude: [] }
    });

    const relative = files.map((file) => path.relative(root, file).replace(/\\/g, "/")).sort();
    expect(relative).toEqual(["docs/included.md"]);
  });

  it("can disable root gitignore filtering", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-scan-no-gitignore-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "included.md"), "# Included\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "ignored.md"), "# Ignored but useful\n", "utf8");
    fs.writeFileSync(path.join(root, ".gitignore"), "docs/ignored.md\n", "utf8");

    const files = await scanMarkdownFiles(root, {
      ...DEFAULT_CONFIG,
      docs: { include: ["docs/**/*.md"], exclude: [] },
      index: { ...DEFAULT_CONFIG.index, followGitignore: false }
    });

    const relative = files.map((file) => path.relative(root, file).replace(/\\/g, "/")).sort();
    expect(relative).toEqual(["docs/ignored.md", "docs/included.md"]);
  });

  it("excludes common generated and dependency directories recursively by default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-scan-common-ignore-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "web", "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(root, "temp", "snapshot"), { recursive: true });
    fs.mkdirSync(path.join(root, "packages", "app", "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "included.md"), "# Included\n", "utf8");
    fs.writeFileSync(path.join(root, "web", "node_modules", "pkg", "README.md"), "# Dependency\n", "utf8");
    fs.writeFileSync(path.join(root, "temp", "snapshot", "copy.md"), "# Temp\n", "utf8");
    fs.writeFileSync(path.join(root, "packages", "app", "dist", "bundle.md"), "# Build\n", "utf8");

    const files = await scanMarkdownFiles(root, DEFAULT_CONFIG);

    const relative = files.map((file) => path.relative(root, file).replace(/\\/g, "/")).sort();
    expect(relative).toEqual(["docs/included.md"]);
  });

  it("respects include, exclude, max file size, MDX switch, and root gitignore", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-scan-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "included.md"), "# Included\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "ignored.md"), "# Ignored\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "large.md"), "# Large\n".repeat(20), "utf8");
    fs.writeFileSync(path.join(root, "docs", "component.mdx"), "# MDX\n", "utf8");
    fs.writeFileSync(path.join(root, ".gitignore"), "docs/ignored.md\n", "utf8");

    const files = await scanMarkdownFiles(root, {
      ...DEFAULT_CONFIG,
      docs: { include: ["docs/**/*"], exclude: ["**/excluded/**"] },
      index: { ...DEFAULT_CONFIG.index, maxFileBytes: 80, parseMdx: true, followGitignore: true }
    });

    const relative = files.map((file) => path.relative(root, file).replace(/\\/g, "/")).sort();
    expect(relative).toEqual(["docs/component.mdx", "docs/included.md"]);
  });
});

describe("database opening", () => {
  it("does not create a database when opening an existing index is required", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-db-existing-"));
    tempDirs.push(root);

    expect(() => openExistingDatabase(root)).toThrow(/mdgraph index/);
    expect(fs.existsSync(databasePath(root))).toBe(false);
  });
});

describe("LinkResolver", () => {
  it("resolves relative links, anchors, aliases, and Windows-style references", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-resolver-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    const nestedDir = path.join(docsDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const indexPath = path.join(docsDir, "index.md");
    const targetPath = path.join(docsDir, "target.md");
    const nestedPath = path.join(nestedDir, "child.md");
    fs.writeFileSync(indexPath, "---\nid: docs-index\ntitle: Docs Index\n---\n# Docs Index\n", "utf8");
    fs.writeFileSync(targetPath, "# Target Doc\n\n## Target Section\n", "utf8");
    fs.writeFileSync(nestedPath, "# Child\n", "utf8");

    const documents = [indexPath, targetPath, nestedPath].map((file) => parseMarkdownDocument(root, file));
    const resolver = new LinkResolver(documents);
    const child = documents.find((document) => document.relativePath.endsWith("child.md"));
    const index = documents.find((document) => document.relativePath.endsWith("index.md"));

    expect(child).toBeDefined();
    expect(index).toBeDefined();
    expect(resolver.resolveMarkdownUrl("../target.md#target-section", child!)?.sectionId).toBeDefined();
    expect(resolver.resolveDocumentRef("docs-index")?.documentId).toBe(index!.id);
    expect(resolver.resolveDocumentRef("docs\\target.md")?.documentId).toBe(documents.find((document) => document.relativePath.endsWith("target.md"))!.id);
    expect(resolver.resolveDocumentRef("missing.md")).toBeUndefined();
  });

  it("does not resolve ambiguous basename aliases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-resolver-ambiguous-"));
    tempDirs.push(root);
    const firstDir = path.join(root, "docs", "first");
    const secondDir = path.join(root, "docs", "second");
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });
    const firstPath = path.join(firstDir, "topic.md");
    const secondPath = path.join(secondDir, "topic.md");
    fs.writeFileSync(firstPath, "---\nid: first-topic\ntitle: First Topic\n---\n# Topic\n", "utf8");
    fs.writeFileSync(secondPath, "---\nid: second-topic\ntitle: Second Topic\n---\n# Topic\n", "utf8");

    const documents = [firstPath, secondPath].map((file) => parseMarkdownDocument(root, file));
    const resolver = new LinkResolver(documents);

    expect(resolver.resolveDocumentRef("topic")).toBeUndefined();
    expect(resolver.resolveDocumentRef("docs/first/topic")?.documentId).toBe(documents[0].id);
    expect(resolver.resolveDocumentRef("docs/second/topic")?.documentId).toBe(documents[1].id);
    expect(resolver.resolveDocumentRef("first-topic")?.documentId).toBe(documents[0].id);
    expect(resolver.resolveDocumentRef("second-topic")?.documentId).toBe(documents[1].id);
  });

  it("resolves duplicate heading anchors without overwriting the first canonical anchor", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-resolver-duplicate-anchor-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const sourcePath = path.join(docsDir, "source.md");
    const targetPath = path.join(docsDir, "target.md");
    fs.writeFileSync(sourcePath, "# Source\n\nSee [runtime](./target.md#runtime).\n", "utf8");
    fs.writeFileSync(targetPath, [
      "# Target",
      "",
      "## Runtime",
      "First runtime.",
      "",
      "## Runtime",
      "Second runtime.",
      ""
    ].join("\n"), "utf8");

    const documents = [sourcePath, targetPath].map((file) => parseMarkdownDocument(root, file));
    const source = documents.find((document) => document.relativePath.endsWith("source.md"))!;
    const target = documents.find((document) => document.relativePath.endsWith("target.md"))!;
    const runtimeSections = target.sections.filter((section) => section.heading === "Runtime");
    const resolver = new LinkResolver(documents);

    expect(runtimeSections.map((section) => section.anchor)).toEqual(["runtime", "runtime-2"]);
    expect(resolver.resolveMarkdownUrl("./target.md#runtime", source)?.sectionId).toBe(runtimeSections[0].id);
    expect(resolver.resolveMarkdownUrl("./target.md#runtime-2", source)?.sectionId).toBe(runtimeSections[1].id);
    expect(resolver.resolveDocumentRef("./target.md#runtime", source)?.sectionId).toBe(runtimeSections[0].id);
  });
});
