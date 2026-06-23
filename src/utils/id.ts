import { createHash } from "node:crypto";

export function stableId(kind: string, value: string): string {
  const digest = createHash("sha1").update(`${kind}:${value}`).digest("hex").slice(0, 20);
  return `${kind}:${digest}`;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}