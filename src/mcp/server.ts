import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCodes, StdioTransport, type JsonRpcNotification, type JsonRpcRequest, type JsonRpcTransport } from "./transport.js";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_UNINDEXED } from "./server-instructions.js";
import { McpInputError, ToolHandler, hasIndex, tools } from "./tools.js";

export const PROTOCOL_VERSION = "2024-11-05";

export interface MCPServerOptions {
  projectRoot?: string;
}

export class MCPServer {
  private projectRoot: string;
  private toolHandler: ToolHandler;

  constructor(private readonly transport: JsonRpcTransport, options: MCPServerOptions = {}) {
    this.projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.toolHandler = new ToolHandler(this.projectRoot);
  }

  start(): void {
    this.transport.start(this.handleMessage.bind(this));
  }

  stop(): void {
    this.transport.stop();
  }

  private handleMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    const isRequest = "id" in message;

    switch (message.method) {
      case "initialize":
        if (isRequest) {
          this.handleInitialize(message);
        }
        return;
      case "initialized":
        return;
      case "ping":
        if (isRequest) {
          this.transport.sendResult(message.id, {});
        }
        return;
      case "tools/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { tools });
        }
        return;
      case "tools/call":
        if (isRequest) {
          this.handleToolsCall(message);
        }
        return;
      case "resources/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { resources: [] });
        }
        return;
      case "resources/templates/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { resourceTemplates: [] });
        }
        return;
      case "prompts/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { prompts: [] });
        }
        return;
      default:
        if (isRequest) {
          this.transport.sendError(message.id, ErrorCodes.MethodNotFound, `Method not found: ${message.method}`);
        }
    }
  }

  private handleInitialize(request: JsonRpcRequest): void {
    let projectRoot: string;
    try {
      projectRoot = validatedProjectRoot(projectRootFromInitialize(request.params) ?? this.projectRoot);
    } catch (error) {
      this.transport.sendError(request.id, ErrorCodes.InvalidParams, error instanceof Error ? error.message : String(error));
      return;
    }
    this.projectRoot = projectRoot;
    this.toolHandler = new ToolHandler(projectRoot);
    this.transport.sendResult(request.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "mdgraph", version: "0.1.0" },
      instructions: hasIndex(projectRoot) ? SERVER_INSTRUCTIONS : SERVER_INSTRUCTIONS_UNINDEXED
    });
  }

  private handleToolsCall(request: JsonRpcRequest): void {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    if (!params || typeof params.name !== "string") {
      this.transport.sendError(request.id, ErrorCodes.InvalidParams, "Missing tool name");
      return;
    }

    const tool = tools.find((candidate) => candidate.name === params.name);
    if (!tool) {
      this.transport.sendError(request.id, ErrorCodes.InvalidParams, `Unknown tool: ${params.name}`);
      return;
    }

    try {
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
      this.transport.sendResult(request.id, this.toolHandler.execute(params.name, args));
    } catch (error) {
      const code = error instanceof McpInputError ? ErrorCodes.InvalidParams : ErrorCodes.InternalError;
      this.transport.sendError(request.id, code, error instanceof Error ? error.message : String(error));
    }
  }
}

export function startStdioMcpServer(options: MCPServerOptions = {}): MCPServer {
  const server = new MCPServer(new StdioTransport(), options);
  server.start();
  return server;
}

function projectRootFromInitialize(params: unknown): string | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as { rootUri?: unknown; workspaceFolders?: Array<{ uri?: unknown }> };
  if (typeof record.rootUri === "string") {
    return fileUriToPath(record.rootUri);
  }
  const firstFolder = record.workspaceFolders?.[0]?.uri;
  return typeof firstFolder === "string" ? fileUriToPath(firstFolder) : undefined;
}

function fileUriToPath(uri: string): string {
  return path.resolve(fileURLToPath(uri));
}

function validatedProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Project root does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project root is not a directory: ${resolved}`);
  }
  return resolved;
}
