import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { MCPServer } from "../src/mcp/server.js";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcTransport } from "../src/mcp/transport.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("MCPServer", () => {
  it("handles initialize, tools/list, and tools/call", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-server-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });
    await transport.receive({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await transport.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "AuthService" } }
    });

    expect(transport.responses[0].result).toMatchObject({ serverInfo: { name: "mdgraph" } });
    expect(JSON.stringify(transport.responses[0].result)).toContain("task-start documentation brief");
    expect(JSON.stringify(transport.responses[0].result)).toContain("Default order for Markdown/documentation questions");
    expect(JSON.stringify(transport.responses[0].result)).toContain("Raw file reads or text search only when MDGraph is inactive");
    expect(JSON.stringify(transport.responses[1].result)).toContain("mdgraph_context");
    expect(JSON.stringify(transport.responses[2].result)).toContain("auth-v2-design.md");
  });

  it("returns unindexed guidance without asking agents to create indexes automatically", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-unindexed-"));
    tempDirs.push(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });

    expect(JSON.stringify(transport.responses[0].result)).toContain("Do not create or");
  });

  it("uses initialize rootUri as the default project root for later tool calls", async () => {
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-server-root-"));
    const initializedRoot = path.join(serverRoot, "workspace");
    tempDirs.push(serverRoot);
    createSingleDoc(initializedRoot, "initialized.md", "InitializedService");
    await indexProject(initializedRoot);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: serverRoot });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(initializedRoot) } });
    await transport.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "InitializedService" } }
    });

    expect(JSON.stringify(transport.responses[1].result)).toContain("initialized.md");
  });

  it("uses workspaceFolders as initialize root when rootUri is absent", async () => {
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-server-folder-root-"));
    const workspaceRoot = path.join(serverRoot, "workspace");
    tempDirs.push(serverRoot);
    createSingleDoc(workspaceRoot, "workspace.md", "WorkspaceService");
    await indexProject(workspaceRoot);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: serverRoot });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { workspaceFolders: [{ uri: pathToFileUri(workspaceRoot) }] } });
    await transport.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "WorkspaceService" } }
    });

    expect(JSON.stringify(transport.responses[1].result)).toContain("workspace.md");
  });

  it("rejects initialize roots outside the served project root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-bound-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-outside-root-"));
    tempDirs.push(root, outside);
    createFixtureDocs(root);
    createFixtureDocs(outside);
    await indexProject(root);
    await indexProject(outside);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(outside) } });

    expect(transport.responses[0].error).toMatchObject({ code: -32602 });
  });

  it("rejects invalid initialize roots instead of silently falling back", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-invalid-root-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(path.join(root, "missing")) } });

    expect(transport.responses[0].error).toMatchObject({ code: -32602 });
  });

  it("separates tool input errors from internal execution errors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-errors-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root });
    server.start();

    await transport.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: {} }
    });
    const configPath = path.join(root, ".mdgraph", "config.json");
    fs.writeFileSync(configPath, "{ invalid", "utf8");
    await transport.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "AuthService" } }
    });

    expect(transport.responses[0].error).toMatchObject({ code: -32602 });
    expect(transport.responses[1].error).toMatchObject({ code: -32603 });
  });
});

class FakeTransport implements JsonRpcTransport {
  responses: Array<{ id: string | number | null; result?: unknown; error?: unknown }> = [];
  private handler: ((message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void) | undefined;

  start(handler: (message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void): void {
    this.handler = handler;
  }

  stop(): void {
    this.handler = undefined;
  }

  async receive(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    await this.handler?.(message);
  }

  sendResult(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }

  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.responses.push({ id, error: { code, message, data } });
  }
}

function pathToFileUri(filePath: string): string {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function createSingleDoc(root: string, fileName: string, entityName: string): void {
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, fileName), [
    "---",
    `title: ${entityName} Doc`,
    "type: design",
    "defines:",
    `  - ${entityName}`,
    "---",
    `# ${entityName}`,
    ""
  ].join("\n"), "utf8");
}
