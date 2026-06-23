import readline from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603
} as const;

export type MessageHandler = (message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void;

export interface JsonRpcTransport {
  start(handler: MessageHandler): void;
  stop(): void;
  sendResult(id: string | number, result: unknown): void;
  sendError(id: string | number | null, code: number, message: string, data?: unknown): void;
}

export class StdioTransport implements JsonRpcTransport {
  private reader: readline.Interface | undefined;
  private handler: MessageHandler | undefined;

  constructor(private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {}

  start(handler: MessageHandler): void {
    this.handler = handler;
    this.reader = readline.createInterface({ input: this.input });
    this.reader.on("line", (line) => {
      void this.handleLine(line);
    });
  }

  stop(): void {
    this.reader?.close();
    this.reader = undefined;
  }

  sendResult(id: string | number, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message, data } });
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.sendError(null, ErrorCodes.ParseError, "Parse error: invalid JSON");
      return;
    }

    if (!isValidMessage(parsed)) {
      this.sendError(null, ErrorCodes.InvalidRequest, "Invalid Request: not a JSON-RPC 2.0 request or notification");
      return;
    }

    try {
      await this.handler?.(parsed);
    } catch (error) {
      if ("id" in parsed) {
        this.sendError(parsed.id, ErrorCodes.InternalError, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private write(response: JsonRpcResponse): void {
    this.output.write(`${JSON.stringify(response)}\n`);
  }
}

function isValidMessage(value: unknown): value is JsonRpcRequest | JsonRpcNotification {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  return message.jsonrpc === "2.0" && typeof message.method === "string";
}