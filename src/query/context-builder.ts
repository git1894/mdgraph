import type { GraphEdge, GraphEntity, MDGraphConfig, SearchResult } from "../types.js";
import { GraphRepository } from "../db/repositories.js";
import { searchGraph } from "./search.js";

const DEFAULT_MAX_CONTEXT_NODES = 16;

export interface ContextItem {
  path: string;
  title: string;
  heading?: string;
  lines?: { start: number; end: number };
  reason: string;
  matchedEntities: string[];
  content: string;
}

export interface ContextResult {
  query: string;
  maxChars: number;
  usedChars: number;
  items: ContextItem[];
  debug?: ContextDebug;
}

export interface ContextDebug {
  seedNodes: number;
  visitedNodes: number;
  expandedEdges: number;
  skippedVisitedNodes: number;
  skippedByNodeLimit: number;
  skippedByDepth: number;
  candidateCount: number;
  directCandidates: number;
  expandedCandidates: number;
  budgetTruncatedItems: number;
  budgetSkippedItems: number;
}

interface ContextCandidate extends ContextItem {
  nodeId: string;
  score: number;
  direct: boolean;
}

interface ExpansionQueueItem {
  nodeId: string;
  depth: number;
  score: number;
  path: string[];
}

export interface ContextBuildOptions {
  debug?: boolean;
}

interface ContextCollection {
  candidates: ContextCandidate[];
  debug: Omit<ContextDebug, "candidateCount" | "directCandidates" | "expandedCandidates" | "budgetTruncatedItems" | "budgetSkippedItems">;
}

interface PackedContext {
  result: ContextResult;
  budgetTruncatedItems: number;
  budgetSkippedItems: number;
}

export function buildContext(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  options: ContextBuildOptions = {}
): ContextResult {
  const results = searchGraph(repository, config, query, config.search.defaultLimit * 2);
  const collection = collectContextCandidates(repository, config, results);
  const packed = packContext(query, collection.candidates, config.search.maxContextChars);
  if (!options.debug) {
    return packed.result;
  }
  return {
    ...packed.result,
    debug: {
      ...collection.debug,
      candidateCount: collection.candidates.length,
      directCandidates: collection.candidates.filter((candidate) => candidate.direct).length,
      expandedCandidates: collection.candidates.filter((candidate) => !candidate.direct).length,
      budgetTruncatedItems: packed.budgetTruncatedItems,
      budgetSkippedItems: packed.budgetSkippedItems
    }
  };
}

function collectContextCandidates(
  repository: GraphRepository,
  config: MDGraphConfig,
  results: SearchResult[]
): ContextCollection {
  const maxDepth = config.search.maxDepth;
  let remainingExpansionNodes = Math.max(DEFAULT_MAX_CONTEXT_NODES, config.search.defaultLimit * 2);
  const candidates = new Map<string, ContextCandidate>();
  const queue: ExpansionQueueItem[] = [];
  const visited = new Set<string>();
  const debug = {
    seedNodes: 0,
    visitedNodes: 0,
    expandedEdges: 0,
    skippedVisitedNodes: 0,
    skippedByNodeLimit: 0,
    skippedByDepth: 0
  };

  for (const result of results) {
    addCandidate(candidates, candidateFromSearchResult(result));
    for (const seed of seedsFromSearchResult(result)) {
      if (visited.has(seed.nodeId)) {
        debug.skippedVisitedNodes += 1;
        continue;
      }
      visited.add(seed.nodeId);
      debug.seedNodes += 1;
      queue.push({ nodeId: seed.nodeId, depth: 0, score: result.score, path: [] });
    }
  }

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) {
      debug.skippedByDepth += 1;
      continue;
    }

    const edges = repository.edgesForNode(current.nodeId)
      .filter((edge) => edge.kind !== "CONTAINS")
      .sort((left, right) => edgeScore(right) - edgeScore(left));

    for (const edge of edges) {
      const nextId = edge.fromId === current.nodeId ? edge.toId : edge.fromId;
      if (visited.has(nextId)) {
        debug.skippedVisitedNodes += 1;
        continue;
      }
      if (remainingExpansionNodes <= 0) {
        debug.skippedByNodeLimit += 1;
        continue;
      }

      const step = formatExpansionStep(repository, current.nodeId, edge);
      const path = [...current.path, step];
      const score = current.score + edgeScore(edge) - (current.depth + 1) * 2;
      visited.add(nextId);
      remainingExpansionNodes -= 1;
      debug.expandedEdges += 1;

      const row = repository.contextChunkForNode(nextId);
      if (row) {
        addCandidate(candidates, {
          path: row.document.path,
          title: row.document.title,
          heading: row.section?.heading,
          lines: row.section ? { start: row.section.startLine, end: row.section.endLine } : undefined,
          reason: `graph expansion via ${path.join(" | ")}`,
          matchedEntities: [],
          content: row.chunk.content,
          nodeId: row.section?.id ?? row.document.id,
          score,
          direct: false
        });
      }

      queue.push({ nodeId: nextId, depth: current.depth + 1, score, path });
    }

    queue.sort((left, right) => right.score - left.score);
  }

  return {
    candidates: orderContextCandidates([...candidates.values()]),
    debug: {
      ...debug,
      visitedNodes: visited.size
    }
  };
}

function orderContextCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  return [
    ...orderContextCandidatesByPath(candidates.filter((candidate) => candidate.direct).sort(compareContextCandidates)),
    ...orderContextCandidatesByPath(candidates.filter((candidate) => !candidate.direct).sort(compareContextCandidates))
  ];
}

function orderContextCandidatesByPath(sorted: ContextCandidate[]): ContextCandidate[] {
  const byPath = new Map<string, ContextCandidate[]>();
  for (const candidate of sorted) {
    byPath.set(candidate.path, [...(byPath.get(candidate.path) ?? []), candidate]);
  }

  const ordered: ContextCandidate[] = [];
  while (byPath.size) {
    for (const [candidatePath, pathCandidates] of byPath) {
      const [candidate, ...remaining] = pathCandidates;
      if (candidate) {
        ordered.push(candidate);
      }
      if (remaining.length) {
        byPath.set(candidatePath, remaining);
      } else {
        byPath.delete(candidatePath);
      }
    }
  }
  return ordered;
}

function compareContextCandidates(left: ContextCandidate, right: ContextCandidate): number {
  if (left.direct !== right.direct) {
    return left.direct ? -1 : 1;
  }
  return right.score - left.score;
}

function packContext(query: string, candidates: ContextCandidate[], maxChars: number): PackedContext {
  const items: ContextItem[] = [];
  let usedChars = 0;
  let budgetTruncatedItems = 0;
  let budgetSkippedItems = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const remaining = maxChars - usedChars;
    if (remaining <= 0) {
      budgetSkippedItems += candidates.length - index;
      break;
    }
    const content = trimToBudget(candidate.content, remaining);
    if (!content) {
      budgetSkippedItems += 1;
      continue;
    }
    if (content.length < candidate.content.length) {
      budgetTruncatedItems += 1;
    }
    usedChars += content.length;
    items.push({
      path: candidate.path,
      title: candidate.title,
      heading: candidate.heading,
      lines: candidate.lines,
      reason: candidate.reason,
      matchedEntities: candidate.matchedEntities,
      content
    });
  }

  return { result: { query, maxChars, usedChars, items }, budgetTruncatedItems, budgetSkippedItems };
}

function candidateFromSearchResult(result: SearchResult): ContextCandidate {
  return {
    path: result.document.path,
    title: result.document.title,
    heading: result.section?.heading,
    lines: result.section ? { start: result.section.startLine, end: result.section.endLine } : undefined,
    reason: result.reason,
    matchedEntities: result.matchedEntities.map(formatMatchedEntity),
    content: result.content,
    nodeId: result.section?.id ?? result.document.id,
    score: result.score,
    direct: true
  };
}

function seedsFromSearchResult(result: SearchResult): Array<{ nodeId: string }> {
  const seeds = new Set<string>();
  seeds.add(result.document.id);
  if (result.section) {
    seeds.add(result.section.id);
  }
  for (const entity of result.matchedEntities) {
    seeds.add(entity.id);
  }
  return [...seeds].map((nodeId) => ({ nodeId }));
}

function addCandidate(candidates: Map<string, ContextCandidate>, candidate: ContextCandidate): void {
  const key = candidate.nodeId;
  const existing = candidates.get(key);
  if (!existing || candidate.score > existing.score || (candidate.direct && !existing.direct)) {
    candidates.set(key, candidate);
  }
}

function edgeScore(edge: GraphEdge): number {
  return edge.weight * edge.confidence;
}

function formatExpansionStep(repository: GraphRepository, currentId: string, edge: GraphEdge): string {
  const currentLabel = repository.getNode(currentId)?.label ?? currentId;
  const nextId = edge.fromId === currentId ? edge.toId : edge.fromId;
  const nextLabel = repository.getNode(nextId)?.label ?? nextId;
  const edgeLabel = `${edge.kind}/${edge.provenance}/${edge.confidence}`;
  return edge.fromId === currentId
    ? `${currentLabel} --${edgeLabel}--> ${nextLabel}`
    : `${currentLabel} <--${edgeLabel}-- ${nextLabel}`;
}

function formatMatchedEntity(entity: GraphEntity): string {
  return `${entity.name} (${entity.kind})`;
}

function trimToBudget(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  if (maxChars <= 3) {
    return content.slice(0, maxChars);
  }
  return `${content.slice(0, maxChars - 3).trimEnd()}...`.slice(0, maxChars);
}
