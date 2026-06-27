import { once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { MCP_LIMITS } from "../src/config/limits.js";
import { StdioTransport } from "../src/mcp/transport.js";

describe("StdioTransport", () => {
  it("rejects oversized JSON-RPC lines before parsing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioTransport(input, output);
    transport.start(() => {
      throw new Error("handler should not receive oversized input");
    });

    input.write(`${" ".repeat(MCP_LIMITS.jsonRpcLineBytes + 1)}\n`);
    const [chunk] = await once(output, "data") as [Buffer];
    transport.stop();

    const response = JSON.parse(chunk.toString("utf8")) as { error?: { code?: number; message?: string } };
    expect(response.error).toMatchObject({ code: -32700 });
    expect(response.error?.message).toContain("exceeds");
  });
});
