import type { GraphEntity, MDGraphConfig, SearchResult } from "../types.js";
import { GraphRepository } from "../db/repositories.js";
import { embedTextLocal, supportsLocalEmbedding } from "../semantic/local-embedding.js";
import { normalizeEntityName } from "../utils/text.js";

export interface SearchOptions {
  semantic?: boolean;
}

export function searchGraph(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  limit = config.search.defaultLimit,
  options: SearchOptions = {}
): SearchResult[] {
  const entityCandidates = extractQueryEntityCandidates(query);
  const matchedEntities = repository.findEntitiesByNormalizedNames(entityCandidates.map(normalizeEntityName));
  const entityDocumentFrequencies = repository.entityDocumentFrequencies(matchedEntities.map((entity) => entity.id));
  const definitionRows = repository.findEntityDefinitions(matchedEntities.map((entity) => entity.id));
  const ftsQuery = toFtsQuery(query);
  const ftsRows = ftsQuery ? repository.searchChunks(ftsQuery, limit * 2) : [];
  const semanticEnabled = options.semantic ?? config.embedding.enabled;
  const semanticRows = semanticEnabled && supportsLocalEmbedding({ ...config, embedding: { ...config.embedding, enabled: true } })
    ? repository.searchSemanticChunks(
      embedTextLocal(query, config.embedding.dimensions),
      config.embedding.provider,
      config.embedding.model,
      limit * 2
    )
    : [];
  const results: SearchResult[] = [];

  for (const row of definitionRows) {
    const matched = matchedEntitiesForContent(matchedEntities, row.chunk.content);
    results.push({
      document: row.document,
      section: row.section,
      score: adjustScore(200 + row.rank, row.document),
      reason: "definition matched an explicit query entity",
      content: row.chunk.content,
      matchedEntities: matched
    });
  }

  for (const row of ftsRows) {
    const matched = matchedEntitiesForContent(matchedEntities, row.chunk.content);
    const penalty = highFrequencyPenalty(matched, entityDocumentFrequencies, config.search.highFrequencyEntityThreshold);
    results.push({
      document: row.document,
      section: row.section,
      score: adjustScore(100 - row.rank, row.document, penalty),
      reason: highFrequencyReason("FTS5 content match", matched, entityDocumentFrequencies, config.search.highFrequencyEntityThreshold),
      content: row.chunk.content,
      matchedEntities: matched
    });
  }

  for (const row of semanticRows) {
    const matched = matchedEntitiesForContent(matchedEntities, row.chunk.content);
    const penalty = highFrequencyPenalty(matched, entityDocumentFrequencies, config.search.highFrequencyEntityThreshold);
    results.push({
      document: row.document,
      section: row.section,
      score: adjustScore(80 + row.similarity * 50, row.document, penalty),
      reason: highFrequencyReason(
        `local semantic vector match (${row.similarity.toFixed(3)})`,
        matched,
        entityDocumentFrequencies,
        config.search.highFrequencyEntityThreshold
      ),
      content: row.chunk.content,
      matchedEntities: matched
    });
  }

  return dedupeResults(results)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function extractQueryEntityCandidates(query: string): string[] {
  const candidates = query.match(/`([^`]+)`|\b[A-Z][A-Za-z0-9_.]+\b|\b[A-Z][A-Z0-9_]{2,}\b|\/[A-Za-z0-9_./:{}-]+/g) ?? [];
  return candidates.map((candidate) => candidate.replace(/^`|`$/g, "").trim()).filter(Boolean);
}

function toFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)
    ?.flatMap((token) => token.split("_"))
    ?.filter((token) => token.length > 1)
    .filter((token) => !isFtsOperatorToken(token))
    .slice(0, 12) ?? [];
  return [...new Set(tokens)].map((token) => `${escapeFtsToken(token)}*`).join(" OR ");
}

function isFtsOperatorToken(token: string): boolean {
  return token === "and" || token === "or" || token === "not" || token === "near";
}

function escapeFtsToken(token: string): string {
  return token.replace(/[^\p{L}\p{N}_]/gu, "");
}

function matchedEntitiesForContent(entities: GraphEntity[], content: string): GraphEntity[] {
  const lowerContent = content.toLowerCase();
  return entities.filter((entity) => lowerContent.includes(entity.name.toLowerCase()) || lowerContent.includes(entity.normalizedName));
}

function adjustScore(score: number, document: SearchResult["document"], entityFrequencyPenalty = 0): number {
  return score + trustTierBoost(document.trustTier) + statusBoost(document.status) + entityFrequencyPenalty;
}

function highFrequencyPenalty(
  entities: GraphEntity[],
  documentFrequencies: Map<string, number>,
  threshold: number
): number {
  const highFrequencyCount = highFrequencyEntities(entities, documentFrequencies, threshold).length;
  return highFrequencyCount ? -Math.min(60, highFrequencyCount * 20) : 0;
}

function highFrequencyReason(
  reason: string,
  entities: GraphEntity[],
  documentFrequencies: Map<string, number>,
  threshold: number
): string {
  const highFrequency = highFrequencyEntities(entities, documentFrequencies, threshold);
  if (!highFrequency.length) {
    return reason;
  }
  const details = highFrequency
    .map((entity) => `${entity.name} in ${documentFrequencies.get(entity.id) ?? 0} docs`)
    .join(", ");
  return `${reason}; down-ranked high-frequency entity match (${details})`;
}

function highFrequencyEntities(
  entities: GraphEntity[],
  documentFrequencies: Map<string, number>,
  threshold: number
): GraphEntity[] {
  return entities.filter((entity) => (documentFrequencies.get(entity.id) ?? 0) > threshold);
}

function trustTierBoost(trustTier: SearchResult["document"]["trustTier"]): number {
  switch (trustTier) {
    case "validated":
      return 8;
    case "authored":
      return 5;
    case "generated":
      return -5;
    case "external":
      return -10;
    case "untrusted":
      return -30;
  }
}

function statusBoost(status: string): number {
  const normalized = status.trim().toLowerCase();
  if (!normalized || normalized === "active") {
    return 0;
  }
  if (normalized === "deprecated" || normalized === "superseded") {
    return -20;
  }
  if (normalized === "draft" || normalized === "archived") {
    return -8;
  }
  return 0;
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const bestByKey = new Map<string, SearchResult>();
  for (const result of results) {
    const key = result.section?.id ?? result.document.id;
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, { ...result, matchedEntities: [...result.matchedEntities] });
      continue;
    }
    const best = result.score > existing.score ? result : existing;
    bestByKey.set(key, {
      ...best,
      score: Math.max(existing.score, result.score),
      reason: mergeReasons(existing.reason, result.reason),
      matchedEntities: mergeMatchedEntities(existing.matchedEntities, result.matchedEntities)
    });
  }
  return [...bestByKey.values()];
}

function mergeReasons(left: string, right: string): string {
  return [...new Set([...left.split("; "), ...right.split("; ")].filter(Boolean))].join("; ");
}

function mergeMatchedEntities(left: GraphEntity[], right: GraphEntity[]): GraphEntity[] {
  return [...new Map([...left, ...right].map((entity) => [entity.id, entity])).values()];
}
