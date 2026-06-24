import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { ToolHandler, hasIndex, tools } from "../src/mcp/tools.js";
import { createFixtureDocs } from "./fixtures.js";

interface NodeToolStructuredContent {
  error?: string;
  candidates?: unknown[];
  node?: { data: { anchor?: string } };
}

interface ContextToolStructuredContent {
  context: {
    maxChars: number;
    usedChars: number;
    knownFiles?: string[];
    suggestedNextQueries?: string[];
    items: Array<{ path: string; reason: string }>;
  };
}

interface StatusToolStructuredContent {
  freshness?: {
    state: string;
    lastIndexedAt?: string;
    recommendation: string;
  };
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("ToolHandler", () => {
  it("keeps the MCP tool surface small and agent-oriented", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "mdgraph_search",
      "mdgraph_context",
      "mdgraph_node",
      "mdgraph_trace",
      "mdgraph_status"
    ]);
    expect(tools.find((tool) => tool.name === "mdgraph_context")?.description).toContain("task-start documentation brief");
    expect(tools.find((tool) => tool.name === "mdgraph_status")?.description).toContain("Use first");
  });

  it("reports inactive status without creating a database", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-empty-"));
    tempDirs.push(root);
    const handler = new ToolHandler(root);

    const result = handler.execute("mdgraph_status");

    expect(result.content[0].text).toContain("inactive");
    expect(hasIndex(root)).toBe(false);
  });

  it("executes search, context, node, trace, and status tools against an index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-tools-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const handler = new ToolHandler(root);

    expect(handler.execute("mdgraph_status").content[0].text).toContain("active");
    expect(handler.execute("mdgraph_search", { query: "AuthService" }).content[0].text).toContain("auth-v2-design.md");
    expect(handler.execute("mdgraph_context", { query: "RedisTimeoutError login" }).content[0].text).toContain("Context for");
    expect(handler.execute("mdgraph_node", { query: "AuthService" }).content[0].text).toContain("entity: AuthService");
    expect(handler.execute("mdgraph_trace", { from: "AuthService", to: "RedisTimeoutError" }).content[0].text).toContain("Trace:");
  });

  it("builds agent task-start context from known files and a character budget", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-context-known-files-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const handler = new ToolHandler(root);
    const result = handler.execute("mdgraph_context", {
      query: "unrelated task text",
      knownFiles: ["src/auth/AuthService.ts"],
      maxChars: 120
    });
    const content = result.structuredContent as ContextToolStructuredContent;

    expect(result.content[0].text).toContain("Known files: src/auth/AuthService.ts");
    expect(result.content[0].text).toContain("Suggested next queries:");
    expect(content.context.maxChars).toBe(120);
    expect(content.context.usedChars).toBeLessThanOrEqual(120);
    expect(content.context.knownFiles).toEqual(["src/auth/AuthService.ts"]);
    expect(content.context.items.some((item) => item.path === "docs/auth-v2-design.md")).toBe(true);
  });

  it("returns lightweight freshness metadata from status", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-status-freshness-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const handler = new ToolHandler(root);
    const result = handler.execute("mdgraph_status");
    const content = result.structuredContent as StatusToolStructuredContent;

    expect(result.content[0].text).toContain("Freshness: not file-checked");
    expect(content.freshness).toMatchObject({ state: "not_checked" });
    expect(content.freshness?.lastIndexedAt).toBeTruthy();
  });

  it("resolves sections by path anchor and reports ambiguous heading queries", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-node-section-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "one.md"), "# One\n\n## Runtime\nFirst runtime.\n", "utf8");
    fs.writeFileSync(path.join(docsDir, "two.md"), "# Two\n\n## Runtime\nSecond runtime.\n", "utf8");
    await indexProject(root);

    const handler = new ToolHandler(root);
    const section = handler.execute("mdgraph_node", { query: "docs/one.md#runtime" });
    const ambiguous = handler.execute("mdgraph_node", { query: "Runtime" });
    const sectionContent = section.structuredContent as NodeToolStructuredContent;
    const ambiguousContent = ambiguous.structuredContent as NodeToolStructuredContent;

    expect(section.content[0].text).toContain("section: Runtime");
    expect(sectionContent.node?.data.anchor).toBe("runtime");
    expect(ambiguous.content[0].text).toContain("Ambiguous section query");
    expect(ambiguousContent.error).toBe("ambiguous_section");
    expect(ambiguousContent.candidates).toHaveLength(2);
  });
});