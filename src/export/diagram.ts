import type { TraceResult } from "../query/trace.js";

export interface MermaidTraceExport {
  format: "mdgraph-mermaid";
  formatVersion: 1;
  diagramType: "trace";
  found: boolean;
  diagram: string;
  trace: TraceResult;
}

export function buildMermaidTraceExport(trace: TraceResult): MermaidTraceExport {
  return {
    format: "mdgraph-mermaid",
    formatVersion: 1,
    diagramType: "trace",
    found: trace.found,
    diagram: formatTraceMermaid(trace),
    trace
  };
}

export function formatTraceMermaid(trace: TraceResult): string {
  if (!trace.found || !trace.steps.length) {
    const message = trace.message ?? "No trace path found.";
    return [`%% ${escapeMermaidComment(message)}`, "flowchart LR"].join("\n");
  }
  const labels = new Map<string, string>();
  for (const step of trace.steps) {
    labels.set(step.fromId, step.fromLabel);
    labels.set(step.toId, step.toLabel);
  }
  const lines = ["flowchart LR"];
  for (const [nodeId, label] of [...labels.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(`  ${mermaidNodeId(nodeId)}["${escapeMermaidLabel(label)}"]`);
  }
  for (const step of trace.steps) {
    const left = mermaidNodeId(step.fromId);
    const right = mermaidNodeId(step.toId);
    const label = `${step.edgeKind} / ${step.provenance} / ${step.confidence.toFixed(2)}`;
    lines.push(`  ${left} -- "${escapeMermaidLabel(label)}" --> ${right}`);
  }
  return lines.join("\n");
}

function mermaidNodeId(id: string): string {
  return `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function escapeMermaidComment(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/--/g, "- -");
}
