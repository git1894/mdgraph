import type { DocumentFrontmatter, DocumentKind, TrustTier } from "../types.js";
import { asStringArray } from "../utils/text.js";
import { parse as parseYaml } from "yaml";

export interface ParsedFrontmatterBlock {
  data: Record<string, unknown>;
  body: string;
  bodyLineOffset: number;
}

const documentKinds = new Set<DocumentKind>([
  "spec",
  "design",
  "adr",
  "api",
  "runbook",
  "incident",
  "meeting",
  "guide",
  "memory",
  "other"
]);

const trustTiers = new Set<TrustTier>(["authored", "generated", "validated", "external", "untrusted"]);

export function parseFrontmatterBlock(raw: string): ParsedFrontmatterBlock {
  const text = stripBom(raw);
  const openingLine = readLine(text, 0);
  if (!isYamlDelimiter(openingLine.text)) {
    return { data: {}, body: text, bodyLineOffset: 0 };
  }

  let offset = openingLine.nextOffset;
  let lineNumber = 1;
  while (offset < text.length) {
    const line = readLine(text, offset);
    lineNumber += 1;
    if (isYamlDelimiter(line.text)) {
      const yamlText = text.slice(openingLine.nextOffset, line.startOffset);
      return {
        data: safeParseYamlMapping(yamlText),
        body: text.slice(line.nextOffset),
        bodyLineOffset: lineNumber
      };
    }
    offset = line.nextOffset;
  }

  return { data: {}, body: text, bodyLineOffset: 0 };
}

export function normalizeFrontmatter(input: Record<string, unknown>): DocumentFrontmatter {
  return {
    ...input,
    id: stringField(input.id),
    title: stringField(input.title),
    type: documentKindField(input.type),
    status: stringField(input.status),
    tags: asStringArray(input.tags),
    defines: asStringArray(input.defines),
    depends_on: asStringArray(input.depends_on),
    implements: asStringArray(input.implements),
    supersedes: asStringArray(input.supersedes),
    deprecated_by: asStringArray(input.deprecated_by),
    source_refs: asStringArray(input.source_refs),
    trust_tier: trustTierField(input.trust_tier)
  };
}

function parseYamlMapping(yamlText: string): Record<string, unknown> {
  if (!yamlText.trim()) {
    return {};
  }
  const parsed = parseYaml(yamlText) as unknown;
  if (isRecord(parsed)) {
    return parsed;
  }
  throw new Error("YAML front matter must be a mapping");
}

function safeParseYamlMapping(yamlText: string): Record<string, unknown> {
  try {
    return parseYamlMapping(yamlText);
  } catch {
    return {};
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isYamlDelimiter(line: string): boolean {
  return /^---[ \t]*$/.test(line);
}

function readLine(input: string, startOffset: number): { text: string; startOffset: number; nextOffset: number } {
  const newlineIndex = input.indexOf("\n", startOffset);
  if (newlineIndex === -1) {
    return { text: input.slice(startOffset).replace(/\r$/, ""), startOffset, nextOffset: input.length };
  }
  return {
    text: input.slice(startOffset, newlineIndex).replace(/\r$/, ""),
    startOffset,
    nextOffset: newlineIndex + 1
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function documentKindField(value: unknown): DocumentKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase() as DocumentKind;
  return documentKinds.has(normalized) ? normalized : undefined;
}

function trustTierField(value: unknown): TrustTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase() as TrustTier;
  return trustTiers.has(normalized) ? normalized : undefined;
}