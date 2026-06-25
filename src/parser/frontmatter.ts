import type { DocumentFrontmatter, DocumentKind, FrontmatterDiagnostic, TrustTier } from "../types.js";
import { asStringArray } from "../utils/text.js";
import { parse as parseYaml } from "yaml";

export interface ParsedFrontmatterBlock {
  data: Record<string, unknown>;
  body: string;
  bodyLineOffset: number;
  diagnostics: FrontmatterDiagnostic[];
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
    return { data: {}, body: text, bodyLineOffset: 0, diagnostics: [] };
  }

  let offset = openingLine.nextOffset;
  let lineNumber = 1;
  while (offset < text.length) {
    const line = readLine(text, offset);
    lineNumber += 1;
    if (isYamlDelimiter(line.text)) {
      const yamlText = text.slice(openingLine.nextOffset, line.startOffset);
      const parsed = parseYamlMapping(yamlText, 2);
      const fieldLines = frontmatterFieldLines(yamlText, 2);
      return {
        data: parsed.data,
        body: text.slice(line.nextOffset),
        bodyLineOffset: lineNumber,
        diagnostics: [...parsed.diagnostics, ...diagnoseFrontmatterFields(parsed.data, fieldLines)]
      };
    }
    offset = line.nextOffset;
  }

  return {
    data: {},
    body: text,
    bodyLineOffset: 0,
    diagnostics: [{
      code: "front_matter.unclosed",
      message: "YAML front matter was opened but not closed.",
      line: 1
    }]
  };
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

export function diagnoseFrontmatterFields(input: Record<string, unknown>, fieldLines = new Map<string, number>()): FrontmatterDiagnostic[] {
  const diagnostics: FrontmatterDiagnostic[] = [];
  for (const field of ["id", "title", "status"]) {
    if (field in input && !stringField(input[field])) {
      diagnostics.push(invalidFieldDiagnostic(field, "non-empty string", input[field], fieldLines));
    }
  }
  if ("type" in input && !documentKindField(input.type)) {
    diagnostics.push(invalidFieldDiagnostic("type", "known document kind string", input.type, fieldLines));
  }
  if ("trust_tier" in input && !trustTierField(input.trust_tier)) {
    diagnostics.push(invalidFieldDiagnostic("trust_tier", "known trust tier string", input.trust_tier, fieldLines));
  }
  for (const field of ["tags", "defines", "depends_on", "implements", "supersedes", "deprecated_by", "source_refs"]) {
    if (field in input && !isStringOrStringArray(input[field])) {
      diagnostics.push(invalidFieldDiagnostic(field, "string or string array", input[field], fieldLines));
    }
  }
  return diagnostics;
}

function parseYamlMapping(yamlText: string, line: number): { data: Record<string, unknown>; diagnostics: FrontmatterDiagnostic[] } {
  if (!yamlText.trim()) {
    return { data: {}, diagnostics: [] };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText) as unknown;
  } catch (error) {
    return {
      data: {},
      diagnostics: [{
        code: "front_matter.invalid_yaml",
        message: error instanceof Error ? error.message : "Invalid YAML front matter.",
        line
      }]
    };
  }
  if (isRecord(parsed)) {
    return { data: parsed, diagnostics: [] };
  }
  return {
    data: {},
    diagnostics: [{
      code: "front_matter.not_mapping",
      message: "YAML front matter must be a mapping.",
      line
    }]
  };
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isYamlDelimiter(line: string): boolean {
  return /^---[ \t]*$/.test(line);
}

function frontmatterFieldLines(yamlText: string, startLine: number): Map<string, number> {
  const lines = new Map<string, number>();
  let lineNumber = startLine - 1;
  for (const line of yamlText.split(/\r?\n/)) {
    lineNumber += 1;
    const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (match && !lines.has(match[1])) {
      lines.set(match[1], lineNumber);
    }
  }
  return lines;
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

function isStringOrStringArray(value: unknown): boolean {
  if (typeof value === "string" && value.trim()) {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
}

function invalidFieldDiagnostic(field: string, expected: string, value: unknown, fieldLines: Map<string, number>): FrontmatterDiagnostic {
  return {
    code: "front_matter.invalid_field",
    message: `Front matter field '${field}' must be ${expected}.`,
    line: fieldLines.get(field) ?? 2,
    field,
    expected,
    actual: describeValue(value)
  };
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(${value.map(describeValue).join(",")})`;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}
