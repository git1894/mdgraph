import fs from "node:fs";
import { JSON_ARTIFACT_LIMITS } from "../config/limits.js";

export interface BoundedJsonOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxArrayLength?: number;
}

export function readBoundedJsonFile(filePath: string, label = "JSON artifact", options: BoundedJsonOptions = {}): unknown {
  const limits = jsonLimits(options);
  const size = fs.statSync(filePath).size;
  if (size > limits.maxBytes) {
    throw new Error(`${label} exceeds ${limits.maxBytes} bytes.`);
  }
  return parseBoundedJsonString(fs.readFileSync(filePath, "utf8"), label, options);
}

export function parseBoundedJsonString(raw: string, label = "JSON artifact", options: BoundedJsonOptions = {}): unknown {
  const limits = jsonLimits(options);
  if (Buffer.byteLength(raw, "utf8") > limits.maxBytes) {
    throw new Error(`${label} exceeds ${limits.maxBytes} bytes.`);
  }
  const parsed = JSON.parse(raw) as unknown;
  assertBoundedJsonValue(parsed, label, options);
  return parsed;
}

export function assertBoundedJsonValue(value: unknown, label = "JSON artifact", options: BoundedJsonOptions = {}): void {
  const limits = jsonLimits(options);
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;

  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new Error(`${label} exceeds ${limits.maxNodes} JSON nodes.`);
    }
    if (current.depth > limits.maxDepth) {
      throw new Error(`${label} exceeds JSON depth ${limits.maxDepth}.`);
    }
    if (!current.value || typeof current.value !== "object") {
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayLength) {
        throw new Error(`${label} exceeds array length ${limits.maxArrayLength}.`);
      }
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    for (const item of Object.values(current.value as Record<string, unknown>)) {
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }
}

function jsonLimits(options: BoundedJsonOptions): Required<BoundedJsonOptions> {
  return {
    maxBytes: options.maxBytes ?? JSON_ARTIFACT_LIMITS.maxBytes,
    maxDepth: options.maxDepth ?? JSON_ARTIFACT_LIMITS.maxDepth,
    maxNodes: options.maxNodes ?? JSON_ARTIFACT_LIMITS.maxNodes,
    maxArrayLength: options.maxArrayLength ?? JSON_ARTIFACT_LIMITS.maxArrayLength
  };
}
