import type { GraphEntity, MDGraphConfig, SearchQueryMode, SearchResult } from "../types.js";
import { GraphRepository } from "../db/repositories.js";
import { embedTextLocal, supportsLocalEmbedding } from "../semantic/local-embedding.js";
import { ftsQueryFor } from "../utils/fts.js";
import { normalizeEntityName } from "../utils/text.js";

type SearchChannel = "definition" | "fts" | "semantic";

export interface SearchOptions {
  semantic?: boolean;
  queryMode?: SearchQueryMode;
}

export interface SearchExplanation {
  query: string;
  limit: number;
  queryMode: SearchQueryMode;
  entityCandidates: string[];
  ftsQuery: string;
  semanticEnabled: boolean;
  semanticActive: boolean;
  ranking: {
    fusion: "rrf";
    fusionK: number;
    channels: SearchChannel[];
    optionalReranker: "none" | "local-hash";
  };
  matchedEntities: Array<{ name: string; kind: GraphEntity["kind"]; documentFrequency: number }>;
  results: SearchResult[];
}

interface ChannelSearchResult {
  channel: SearchChannel;
  rank: number;
  result: SearchResult;
}

const RRF_K = 60;
const RRF_SCORE_WEIGHT = 1_000;

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
  const ftsQuery = ftsQueryFor(query);
  const ftsRows = ftsQuery ? repository.searchChunks(ftsQuery, limit * 2) : [];
  const mode = resolveSearchMode(config, options);
  const semanticRows = mode.semanticActive
    ? repository.searchSemanticChunks(
      embedTextLocal(query, config.embedding.dimensions),
      config.embedding.provider,
      config.embedding.model,
      limit * 2
    )
    : [];
  const results: ChannelSearchResult[] = [];

  for (const [index, row] of definitionRows.entries()) {
    const matched = matchedEntitiesForContent(matchedEntities, row.chunk.content);
    results.push({
      channel: "definition",
      rank: index + 1,
      result: {
        document: row.document,
        section: row.section,
        score: adjustScore(200 + row.rank, row.document),
        reason: "definition matched an explicit query entity",
        content: row.chunk.content,
        matchedEntities: matched
      }
    });
  }

  for (const [index, row] of ftsRows.entries()) {
    const matched = matchedEntitiesForContent(matchedEntities, row.chunk.content);
    const penalty = highFrequencyPenalty(matched, entityDocumentFrequencies, config.search.highFrequencyEntityThreshold);
    results.push({
      channel: "fts",
      rank: index + 1,
      result: {
        document: row.document,
        section: row.section,
        score: adjustScore(100 - row.rank, row.document, penalty),
        reason: highFrequencyReason("FTS5 content match", matched, entityDocumentFrequencies, config.search.highFrequencyEntityThreshold),
        content: row.chunk.content,
        matchedEntities: matched
      }
    });
  }

  for (const [index, row] of semanticRows.entries()) {
    const matched = matchedEntitiesForContent(matchedEntities, row.chunk.content);
    const penalty = highFrequencyPenalty(matched, entityDocumentFrequencies, config.search.highFrequencyEntityThreshold);
    results.push({
      channel: "semantic",
      rank: index + 1,
      result: {
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
        matchedEntities: matched,
        semantic: {
          source: "chunk_vector",
          provider: config.embedding.provider,
          model: config.embedding.model,
          confidence: Number(row.similarity.toFixed(4))
        }
      }
    });
  }

  return dedupeResults(applyReciprocalRankFusion(results))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function explainSearchGraph(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  limit = config.search.defaultLimit,
  options: SearchOptions = {}
): SearchExplanation {
  const entityCandidates = extractQueryEntityCandidates(query);
  const matchedEntities = repository.findEntitiesByNormalizedNames(entityCandidates.map(normalizeEntityName));
  const frequencies = repository.entityDocumentFrequencies(matchedEntities.map((entity) => entity.id));
  const mode = resolveSearchMode(config, options);
  const results = searchGraph(repository, config, query, limit, options);
  const channels = channelsForResults(results);
  const semanticActive = mode.semanticActive && channels.includes("semantic");
  return {
    query,
    limit,
    queryMode: mode.queryMode,
    entityCandidates,
    ftsQuery: ftsQueryFor(query),
    semanticEnabled: mode.semanticRequested,
    semanticActive,
    ranking: {
      fusion: "rrf",
      fusionK: RRF_K,
      channels,
      optionalReranker: semanticActive ? "local-hash" : "none"
    },
    matchedEntities: matchedEntities.map((entity) => ({
      name: entity.name,
      kind: entity.kind,
      documentFrequency: frequencies.get(entity.id) ?? 0
    })),
    results
  };
}

export function extractQueryEntityCandidates(query: string): string[] {
  const candidates = query.match(/`([^`]+)`|\b[A-Z][A-Za-z0-9_.]+\b|\b[A-Z][A-Z0-9_]{2,}\b|\/[A-Za-z0-9_./:{}-]+/g) ?? [];
  return candidates.map((candidate) => candidate.replace(/^`|`$/g, "").trim()).filter(Boolean);
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

function resolveSearchMode(config: MDGraphConfig, options: SearchOptions): {
  queryMode: SearchQueryMode;
  semanticRequested: boolean;
  semanticActive: boolean;
} {
  const queryMode = options.queryMode ?? (options.semantic ? "semantic" : "auto");
  const semanticRequested = queryMode === "semantic" || (queryMode === "auto" && (options.semantic ?? config.embedding.enabled));
  const semanticActive = semanticRequested && supportsLocalEmbedding({ ...config, embedding: { ...config.embedding, enabled: true } });
  return { queryMode, semanticRequested, semanticActive };
}

function applyReciprocalRankFusion(results: ChannelSearchResult[]): SearchResult[] {
  const fusionByKey = new Map<string, { score: number; channels: Array<{ channel: SearchChannel; rank: number }> }>();
  const seenChannelKeys = new Set<string>();
  for (const item of results) {
    const key = resultKey(item.result);
    const channelKey = `${item.channel}:${key}`;
    if (seenChannelKeys.has(channelKey)) {
      continue;
    }
    seenChannelKeys.add(channelKey);
    const existing = fusionByKey.get(key) ?? { score: 0, channels: [] };
    existing.score += 1 / (RRF_K + item.rank);
    existing.channels.push({ channel: item.channel, rank: item.rank });
    fusionByKey.set(key, existing);
  }

  return results.map((item) => {
    const fusion = fusionByKey.get(resultKey(item.result));
    if (!fusion) {
      return item.result;
    }
    const boost = Number((fusion.score * RRF_SCORE_WEIGHT).toFixed(4));
    return {
      ...item.result,
      score: Number((item.result.score + boost).toFixed(4)),
      reason: mergeReasons(item.result.reason, formatRrfReason(fusion.channels))
    };
  });
}

function formatRrfReason(channels: Array<{ channel: SearchChannel; rank: number }>): string {
  const details = channels
    .sort((left, right) => left.channel.localeCompare(right.channel) || left.rank - right.rank)
    .map((item) => `${item.channel}#${item.rank}`)
    .join(", ");
  return `RRF fusion (${details})`;
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const bestByKey = new Map<string, SearchResult>();
  for (const result of results) {
    const key = resultKey(result);
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
      matchedEntities: mergeMatchedEntities(existing.matchedEntities, result.matchedEntities),
      semantic: best.semantic ?? existing.semantic ?? result.semantic
    });
  }
  return [...bestByKey.values()];
}

function resultKey(result: SearchResult): string {
  return result.section?.id ?? result.document.id;
}

function channelsForResults(results: SearchResult[]): SearchChannel[] {
  const channels = results
    .flatMap((result) => [...result.reason.matchAll(/RRF fusion \(([^)]+)\)/gu)])
    .flatMap((match) => match[1].split(", "))
    .map((detail) => detail.split("#")[0])
    .filter((channel): channel is SearchChannel => channel === "definition" || channel === "fts" || channel === "semantic");
  return [...new Set(channels)];
}

function mergeReasons(left: string, right: string): string {
  return [...new Set([...left.split("; "), ...right.split("; ")].filter(Boolean))].join("; ");
}

function mergeMatchedEntities(left: GraphEntity[], right: GraphEntity[]): GraphEntity[] {
  return [...new Map([...left, ...right].map((entity) => [entity.id, entity])).values()];
}
