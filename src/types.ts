export type DocumentKind =
  | "spec"
  | "design"
  | "adr"
  | "api"
  | "runbook"
  | "incident"
  | "meeting"
  | "guide"
  | "memory"
  | "other";

export type TrustTier = "authored" | "generated" | "validated" | "external" | "untrusted";

export type SearchQueryMode = "auto" | "keyword" | "semantic";

export type EntityKind =
  | "symbol"
  | "api_route"
  | "error_code"
  | "config_key"
  | "file_path"
  | "command"
  | "package"
  | "concept"
  | "decision";

// SAME_AS, RELATED_TO, and CONTRADICTS are reserved graph edge kinds for
// deterministic aliasing, weak relation, and contradiction emitters that are
// not currently produced by the MVP indexer.
export type EdgeKind =
  | "CONTAINS"
  | "DEFINES"
  | "REFERENCES"
  | "DEPENDS_ON"
  | "LINKS_TO"
  | "IMPLEMENTS"
  | "REFERENCES_SOURCE"
  | "SUPERSEDES"
  | "DEPRECATED_BY"
  | "SAME_AS"
  | "RELATED_TO"
  | "CONTRADICTS";

export const RESERVED_EDGE_KINDS = ["SAME_AS", "RELATED_TO", "CONTRADICTS"] as const satisfies readonly EdgeKind[];

export type Provenance =
  | "frontmatter"
  | "markdown_link"
  | "wikilink"
  | "declared_section"
  | "heading"
  | "inline_code"
  | "code_block"
  | "regex";

export interface MDGraphConfig {
  docs: {
    include: string[];
    exclude: string[];
  };
  index: {
    parseMdx: boolean;
    followGitignore: boolean;
    maxFileBytes: number;
  };
  search: {
    defaultLimit: number;
    maxDepth: number;
    maxContextChars: number;
    highFrequencyEntityThreshold: number;
  };
  entities: {
    enabledKinds: EntityKind[];
    stopEntities: string[];
  };
  embedding: {
    enabled: boolean;
    provider: string;
    model: string;
    dimensions: number;
  };
}

export interface DocumentFrontmatter {
  id?: string;
  title?: string;
  type?: DocumentKind;
  status?: string;
  tags?: string[];
  defines?: string[];
  depends_on?: string[];
  implements?: string[];
  supersedes?: string[];
  deprecated_by?: string[];
  source_refs?: string[];
  trust_tier?: TrustTier;
  [key: string]: unknown;
}

export type FrontmatterDiagnosticCode =
  | "front_matter.invalid_yaml"
  | "front_matter.not_mapping"
  | "front_matter.unclosed"
  | "front_matter.invalid_field";

export interface FrontmatterDiagnostic {
  code: FrontmatterDiagnosticCode;
  message: string;
  line: number;
  field?: string;
  expected?: string;
  actual?: string;
}

export interface MarkdownLink {
  text: string;
  url: string;
  title?: string;
  line: number;
  sectionId?: string;
}

export interface WikiLink {
  raw: string;
  target: string;
  anchor?: string;
  alias?: string;
  line: number;
  sectionId?: string;
}

export interface CodeSnippet {
  language?: string;
  value: string;
  line: number;
  sectionId?: string;
}

export interface ParsedSection {
  id: string;
  anchor: string;
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ParsedDocument {
  id: string;
  absolutePath: string;
  relativePath: string;
  title: string;
  hash: string;
  frontmatter: DocumentFrontmatter;
  frontmatterDiagnostics: FrontmatterDiagnostic[];
  body: string;
  sections: ParsedSection[];
  markdownLinks: MarkdownLink[];
  wikiLinks: WikiLink[];
  codeBlocks: CodeSnippet[];
  inlineCode: CodeSnippet[];
}

export interface GraphDocument {
  id: string;
  path: string;
  title: string;
  type: DocumentKind;
  status: string;
  hash: string;
  trustTier: TrustTier;
  updatedAt?: string;
  indexedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GraphSection extends ParsedSection {
  documentId: string;
}

export interface GraphEntity {
  id: string;
  name: string;
  normalizedName: string;
  kind: EntityKind;
  namespace?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface SourceRef {
  id: string;
  path: string;
  normalizedPath: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: EdgeKind;
  weight: number;
  confidence: number;
  provenance: Provenance;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface GraphChunk {
  id: string;
  documentId: string;
  sectionId?: string;
  content: string;
  tokenEstimate: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkVector {
  chunkId: string;
  provider: string;
  model: string;
  dimensions: number;
  vector: number[];
  createdAt: string;
}

export interface SemanticMatchMetadata {
  source: "chunk_vector";
  provider: string;
  model: string;
  confidence: number;
}

export interface GraphRecordSet {
  documents: GraphDocument[];
  sections: GraphSection[];
  entities: GraphEntity[];
  sourceRefs: SourceRef[];
  edges: GraphEdge[];
  chunks: GraphChunk[];
  vectors: ChunkVector[];
}

export interface SearchResult {
  document: GraphDocument;
  section?: GraphSection;
  score: number;
  reason: string;
  content: string;
  matchedEntities: GraphEntity[];
  semantic?: SemanticMatchMetadata;
}

export interface TraceStep {
  fromId: string;
  fromLabel: string;
  edgeFromId: string;
  edgeToId: string;
  edgeKind: EdgeKind;
  toId: string;
  toLabel: string;
  traversalDirection: "forward" | "reverse";
  confidence: number;
  provenance: Provenance;
}

export const EDGE_WEIGHTS: Record<EdgeKind, number> = {
  CONTAINS: 5,
  DEFINES: 10,
  REFERENCES: 4,
  DEPENDS_ON: 9,
  LINKS_TO: 7,
  IMPLEMENTS: 8,
  REFERENCES_SOURCE: 6,
  SUPERSEDES: 8,
  DEPRECATED_BY: 8,
  SAME_AS: 7,
  RELATED_TO: 2,
  CONTRADICTS: 6
};
