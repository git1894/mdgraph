import type { GraphJsonEdge, GraphJsonExport, GraphJsonNode } from "./graphjson.js";

export interface DocsSiteIndex {
  format: "mdgraph-docsite-index";
  formatVersion: 1;
  sourceFormat: "mdgraph-graphjson";
  graphHash: string;
  documents: DocsSiteDocument[];
}

export interface DocsSiteDocument {
  path: string;
  title: string;
  status: string;
  documentType: string;
  trustTier: string;
  defines: string[];
  sourceRefs: string[];
  outboundLinks: string[];
  inboundLinks: string[];
}

export function buildDocsSiteIndex(graph: GraphJsonExport): DocsSiteIndex {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const owningDocumentByNode = owningDocumentMap(graph.nodes);
  const documents = graph.nodes
    .filter((node): node is Extract<GraphJsonNode, { kind: "document" }> => node.kind === "document")
    .map((document) => documentSummary(document, graph.edges, nodesById, owningDocumentByNode))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    format: "mdgraph-docsite-index",
    formatVersion: 1,
    sourceFormat: graph.format,
    graphHash: graph.graphHash,
    documents
  };
}

export function formatObsidianMarkdownIndex(graph: GraphJsonExport): string {
  const index = buildDocsSiteIndex(graph);
  const lines = [
    "# MDGraph Index",
    "",
    `Graph hash: \`${graph.graphHash}\``,
    "",
    "## Documents"
  ];
  for (const document of index.documents) {
    lines.push(
      "",
      `### [[${document.path}]]`,
      "",
      `- Status: ${document.status}`,
      `- Type: ${document.documentType}`,
      `- Trust tier: ${document.trustTier}`,
      `- Defines: ${formatList(document.defines)}`,
      `- Source refs: ${formatList(document.sourceRefs)}`,
      `- Outbound links: ${formatList(document.outboundLinks)}`,
      `- Inbound links: ${formatList(document.inboundLinks)}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function documentSummary(
  document: Extract<GraphJsonNode, { kind: "document" }>,
  edges: GraphJsonEdge[],
  nodesById: Map<string, GraphJsonNode>,
  owningDocumentByNode: Map<string, string>
): DocsSiteDocument {
  const defines = new Set<string>();
  const sourceRefs = new Set<string>();
  const outboundLinks = new Set<string>();
  const inboundLinks = new Set<string>();
  for (const edge of edges) {
    const fromDocument = owningDocumentByNode.get(edge.fromId);
    const toDocument = owningDocumentByNode.get(edge.toId);
    const toNode = nodesById.get(edge.toId);
    const fromNode = nodesById.get(edge.fromId);
    if (fromDocument === document.id && edge.kind === "DEFINES" && toNode?.kind === "entity") {
      defines.add(toNode.label);
    }
    if (fromDocument === document.id && (edge.kind === "IMPLEMENTS" || edge.kind === "REFERENCES_SOURCE") && toNode?.kind === "source_ref") {
      sourceRefs.add(toNode.path);
    }
    if (fromDocument === document.id && toDocument && toDocument !== document.id) {
      outboundLinks.add(labelForDocument(nodesById, toDocument));
    }
    if (toDocument === document.id && fromDocument && fromDocument !== document.id) {
      inboundLinks.add(labelForDocument(nodesById, fromDocument));
    }
    if (edge.toId === document.id && fromNode?.kind === "document") {
      inboundLinks.add(fromNode.path);
    }
  }
  return {
    path: document.path,
    title: document.label,
    status: document.status,
    documentType: document.documentType,
    trustTier: document.trustTier,
    defines: sorted(defines),
    sourceRefs: sorted(sourceRefs),
    outboundLinks: sorted(outboundLinks),
    inboundLinks: sorted(inboundLinks)
  };
}

function owningDocumentMap(nodes: GraphJsonNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "document") {
      map.set(node.id, node.id);
    } else if (node.kind === "section") {
      map.set(node.id, node.documentId);
    }
  }
  return map;
}

function labelForDocument(nodesById: Map<string, GraphJsonNode>, documentId: string): string {
  const node = nodesById.get(documentId);
  return node?.kind === "document" ? node.path : documentId;
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function formatList(values: string[]): string {
  return values.length ? values.map((value) => `\`${value}\``).join(", ") : "none";
}
