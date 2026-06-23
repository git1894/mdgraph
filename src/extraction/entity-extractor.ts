import type { EntityKind, MDGraphConfig, ParsedDocument, Provenance } from "../types.js";
import { normalizeEntityName, uniqueStrings } from "../utils/text.js";

export interface ExtractedEntity {
  name: string;
  kind: EntityKind;
  role: "definition" | "reference";
  provenance: Provenance;
  confidence: number;
  sectionId?: string;
  metadata?: Record<string, unknown>;
}

const apiRoutePattern = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_./:{}-]+|\/[A-Za-z0-9_./:{}-]+/g;
const errorCodePattern = /\b(?:[A-Z][A-Za-z0-9]+Error|ERR_[A-Z0-9_]+|[A-Z]+_[0-9]{3,}|[A-Z]+_[A-Z0-9_]*ERROR[A-Z0-9_]*)\b/g;
const configKeyPattern = /\b(?:[A-Z][A-Z0-9_]{2,}|[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,})\b/g;
const filePathPattern = /(?:^|\s)([\w@.-]+\/[\w@./-]+\.(?:ts|tsx|js|jsx|md|mdx|json|yaml|yml|toml|rs|go|py|java|cs|sql))/g;
const commandPattern = /\b(?:npm|pnpm|yarn|go|cargo|docker|kubectl|node|npx)\s+[^\n`]+/g;
const functionPattern = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\(\)/g;
const symbolPattern = /\b[A-Z][A-Za-z0-9]+(?:\.[A-Za-z_$][\w$]*)?\b/g;

export function extractEntities(document: ParsedDocument, config: MDGraphConfig): ExtractedEntity[] {
  const stopEntities = new Set(config.entities.stopEntities.map(normalizeEntityName));
  const entities: ExtractedEntity[] = [];

  for (const name of document.frontmatter.defines ?? []) {
    pushEntity(entities, name, "definition", "frontmatter", 1, undefined, stopEntities, true);
  }

  for (const section of document.sections) {
    if (isDefinesHeading(section.heading)) {
      for (const name of extractDeclaredDefinitionNames(section.content)) {
        pushEntity(entities, name, "definition", "declared_section", 0.85, section.id, stopEntities, true);
      }
    }

    if (looksLikeEntity(section.heading)) {
      pushEntity(entities, section.heading, "definition", "heading", 0.8, section.id, stopEntities, true);
    }

    for (const name of extractHighConfidenceReferences(section.content)) {
      pushEntity(entities, name, "reference", "regex", 0.6, section.id, stopEntities, false);
    }
  }

  for (const snippet of document.inlineCode) {
    for (const name of extractStructuredNames(snippet.value, true)) {
      pushEntity(entities, name, "reference", "inline_code", 0.75, snippet.sectionId, stopEntities, false);
    }
  }

  for (const snippet of document.codeBlocks) {
    for (const name of extractStructuredNames(snippet.value, true)) {
      pushEntity(entities, name, "reference", "code_block", 0.7, snippet.sectionId, stopEntities, false);
    }
  }

  for (const link of document.markdownLinks) {
    for (const name of extractStructuredNames(`${link.text} ${link.url}`, false)) {
      pushEntity(entities, name, "reference", "markdown_link", 0.7, link.sectionId, stopEntities, false);
    }
  }

  for (const link of document.wikiLinks) {
    const label = link.alias ?? link.target;
    if (looksLikeEntity(label)) {
      pushEntity(entities, label, "reference", "wikilink", 0.7, link.sectionId, stopEntities, false);
    }
  }

  return dedupeEntities(entities).filter((entity) => config.entities.enabledKinds.includes(entity.kind));
}

export function inferEntityKind(name: string): EntityKind {
  const trimmed = name.trim();
  if (/^(?:GET|POST|PUT|PATCH|DELETE)\s+\//.test(trimmed) || trimmed.startsWith("/")) {
    return "api_route";
  }
  if (filePathPattern.test(` ${trimmed}`)) {
    filePathPattern.lastIndex = 0;
    return "file_path";
  }
  filePathPattern.lastIndex = 0;
  if (/^(?:npm|pnpm|yarn|go|cargo|docker|kubectl|node|npx)\s+/.test(trimmed)) {
    return "command";
  }
  if (errorCodePattern.test(trimmed)) {
    errorCodePattern.lastIndex = 0;
    return "error_code";
  }
  errorCodePattern.lastIndex = 0;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(trimmed) || /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(trimmed)) {
    return "config_key";
  }
  if (/^@?[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(trimmed)) {
    return "package";
  }
  if (/^ADR-?\d+$/i.test(trimmed)) {
    return "decision";
  }
  return "symbol";
}

function pushEntity(
  target: ExtractedEntity[],
  rawName: string,
  role: ExtractedEntity["role"],
  provenance: Provenance,
  confidence: number,
  sectionId: string | undefined,
  stopEntities: Set<string>,
  allowStopEntity: boolean
): void {
  const name = cleanupName(rawName);
  if (!name) {
    return;
  }
  const kind = inferEntityKind(name);
  if (!allowStopEntity && kind === "symbol" && stopEntities.has(normalizeEntityName(name))) {
    return;
  }
  target.push({ name, kind, role, provenance, confidence, sectionId });
}

function extractDeclaredDefinitionNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/[-*]\s+`([^`]+)`/g)) {
    names.push(match[1]);
  }
  for (const match of content.matchAll(/^[-*]\s+([A-Za-z0-9_.:/-]+)\s*:/gm)) {
    names.push(match[1]);
  }
  return uniqueStrings(names);
}

function extractHighConfidenceReferences(content: string): string[] {
  return uniqueStrings([
    ...matches(content, apiRoutePattern),
    ...matches(content, errorCodePattern),
    ...matches(content, configKeyPattern)
  ]);
}

function extractStructuredNames(content: string, includeSymbols: boolean): string[] {
  const names = [
    ...matches(content, apiRoutePattern),
    ...matches(content, errorCodePattern),
    ...matches(content, configKeyPattern),
    ...matches(content, commandPattern),
    ...matches(content, functionPattern),
    ...matches(content, filePathPattern, 1)
  ];
  if (includeSymbols) {
    names.push(...matches(content, symbolPattern));
  }
  return uniqueStrings(names);
}

function matches(content: string, pattern: RegExp, group = 0): string[] {
  pattern.lastIndex = 0;
  const result = [...content.matchAll(pattern)].map((match) => match[group] ?? match[0]);
  pattern.lastIndex = 0;
  return result;
}

function isDefinesHeading(heading: string): boolean {
  return /^(defines?|definitions?|定义)$/i.test(heading.trim());
}

function looksLikeEntity(value: string): boolean {
  const trimmed = cleanupName(value);
  return Boolean(trimmed) && (
    /^\/[A-Za-z0-9_./:{}-]+$/.test(trimmed) ||
    /^(?:GET|POST|PUT|PATCH|DELETE)\s+\//.test(trimmed) ||
    /^[A-Z][A-Za-z0-9]+(?:\.[A-Za-z_$][\w$]*)?$/.test(trimmed) ||
    /^[A-Z][A-Z0-9_]{2,}$/.test(trimmed) ||
    /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(trimmed)
  );
}

function cleanupName(value: string): string {
  return value.trim().replace(/^`|`$/g, "").replace(/[.,;:]$/g, "");
}

function dedupeEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Set<string>();
  const deduped: ExtractedEntity[] = [];
  for (const entity of entities) {
    const key = `${entity.role}:${entity.kind}:${normalizeEntityName(entity.name)}:${entity.sectionId ?? "doc"}:${entity.provenance}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entity);
    }
  }
  return deduped;
}