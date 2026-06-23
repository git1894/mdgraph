import type { GraphEdge, TraceStep } from "../types.js";
import { GraphRepository } from "../db/repositories.js";

export interface TraceResult {
  from: string;
  to: string;
  found: boolean;
  steps: TraceStep[];
  message?: string;
}

interface QueueItem {
  nodeId: string;
  path: GraphEdge[];
}

export function traceNodes(repository: GraphRepository, fromQuery: string, toQuery: string, maxDepth = 6): TraceResult {
  const from = repository.resolveNode(fromQuery);
  const to = repository.resolveNode(toQuery);
  if (!from || !to) {
    return {
      from: fromQuery,
      to: toQuery,
      found: false,
      steps: [],
      message: !from ? `Start node not found: ${fromQuery}` : `End node not found: ${toQuery}`
    };
  }

  const queue: QueueItem[] = [{ nodeId: from.id, path: [] }];
  const visited = new Set<string>([from.id]);

  while (queue.length) {
    const current = queue.shift()!;
    if (current.nodeId === to.id) {
      return { from: from.label, to: to.label, found: true, steps: toTraceSteps(repository, from.id, current.path) };
    }
    if (current.path.length >= maxDepth) {
      continue;
    }

    for (const edge of repository.edgesForNode(current.nodeId)) {
      const nextId = edge.fromId === current.nodeId ? edge.toId : edge.fromId;
      if (visited.has(nextId)) {
        continue;
      }
      visited.add(nextId);
      queue.push({ nodeId: nextId, path: [...current.path, edge] });
    }
  }

  return { from: from.label, to: to.label, found: false, steps: [], message: "No path found within the trace depth budget." };
}

function toTraceSteps(repository: GraphRepository, startId: string, path: GraphEdge[]): TraceStep[] {
  const steps: TraceStep[] = [];
  let currentId = startId;
  for (const edge of path) {
    const nextId = edge.fromId === currentId ? edge.toId : edge.fromId;
    const traversalDirection = edge.fromId === currentId ? "forward" : "reverse";
    steps.push({
      fromId: currentId,
      fromLabel: repository.getNode(currentId)?.label ?? currentId,
      edgeFromId: edge.fromId,
      edgeToId: edge.toId,
      edgeKind: edge.kind,
      toId: nextId,
      toLabel: repository.getNode(nextId)?.label ?? nextId,
      traversalDirection,
      confidence: edge.confidence,
      provenance: edge.provenance
    });
    currentId = nextId;
  }
  return steps;
}
