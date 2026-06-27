import type {
  EdgeKind,
  GraphChunk,
  GraphDocument,
  GraphEdge,
  GraphEntity,
  GraphRecordSet,
  GraphSection,
  MDGraphConfig,
  ParsedDocument,
  Provenance,
  SourceRef
} from "../types.js";
import { EDGE_WEIGHTS } from "../types.js";
import { LinkResolver } from "../resolution/link-resolver.js";
import { embedTextLocal, supportsLocalEmbedding } from "../semantic/local-embedding.js";
import { stableId } from "../utils/id.js";
import { estimateTokens, normalizeEntityName, normalizePath } from "../utils/text.js";
import { type ExtractedEntity, extractEntities, inferEntityKind } from "./entity-extractor.js";

export function buildGraphRecords(documents: ParsedDocument[], config: MDGraphConfig): GraphRecordSet {
  const now = new Date().toISOString();
  const resolver = new LinkResolver(documents);
  const graphDocuments: GraphDocument[] = [];
  const sections: GraphSection[] = [];
  const chunks: GraphChunk[] = [];
  const entities: GraphEntity[] = [];
  const sourceRefs: SourceRef[] = [];
  const edges: GraphEdge[] = [];
  const vectors: GraphRecordSet["vectors"] = [];
  const entityByKey = new Map<string, GraphEntity>();
  const sourceRefByPath = new Map<string, SourceRef>();
  const shouldEmbed = supportsLocalEmbedding(config);

  for (const document of documents) {
    graphDocuments.push({
      id: document.id,
      path: document.relativePath,
      title: document.title,
      type: document.frontmatter.type ?? "other",
      status: document.frontmatter.status ?? "active",
      hash: document.hash,
      trustTier: document.frontmatter.trust_tier ?? "authored",
      updatedAt: undefined,
      indexedAt: now,
      metadata: {
        declaredTrustTier: document.frontmatter.trust_tier,
        frontmatterId: document.frontmatter.id,
        tags: document.frontmatter.tags ?? []
      }
    });

    for (const section of document.sections) {
      sections.push({ ...section, documentId: document.id });
      edges.push(makeEdge(document.id, section.id, "CONTAINS", "heading", 1, now));

      const chunk: GraphChunk = {
        id: stableId("chunk", `${section.id}:content`),
        documentId: document.id,
        sectionId: section.id,
        content: section.content,
        tokenEstimate: estimateTokens(section.content),
        metadata: { heading: section.heading, anchor: section.anchor }
      };
      chunks.push(chunk);
      if (shouldEmbed) {
        vectors.push({
          chunkId: chunk.id,
          provider: config.embedding.provider,
          model: config.embedding.model,
          dimensions: config.embedding.dimensions,
          vector: embedTextLocal(chunk.content, config.embedding.dimensions),
          createdAt: now
        });
      }
      edges.push(makeEdge(section.id, chunk.id, "CONTAINS", "heading", 1, now));
    }

    for (const extracted of extractEntities(document, config)) {
      const entity = ensureEntity(entities, entityByKey, extracted, now);
      const fromId = extracted.sectionId ?? document.id;
      edges.push(makeEdge(
        fromId,
        entity.id,
        extracted.role === "definition" ? "DEFINES" : "REFERENCES",
        extracted.provenance,
        extracted.confidence,
        now
      ));
    }

    addSourceRefEdges(document, document.frontmatter.implements ?? [], "IMPLEMENTS", sourceRefs, sourceRefByPath, edges, now);
    addSourceRefEdges(document, document.frontmatter.source_refs ?? [], "REFERENCES_SOURCE", sourceRefs, sourceRefByPath, edges, now);
    addRelationshipEdges(document, document.frontmatter.depends_on ?? [], "DEPENDS_ON", "frontmatter", resolver, entities, entityByKey, edges, now);
    addRelationshipEdges(document, document.frontmatter.supersedes ?? [], "SUPERSEDES", "frontmatter", resolver, entities, entityByKey, edges, now);
    addRelationshipEdges(document, document.frontmatter.deprecated_by ?? [], "DEPRECATED_BY", "frontmatter", resolver, entities, entityByKey, edges, now);

    for (const link of document.markdownLinks) {
      const resolved = resolver.resolveMarkdownUrl(link.url, document);
      if (resolved) {
        edges.push(makeEdge(link.sectionId ?? document.id, resolved.nodeId, "LINKS_TO", "markdown_link", 0.9, now));
      }
    }

    for (const link of document.wikiLinks) {
      const resolved = resolver.resolveDocumentRef(link.target, document, link.anchor);
      if (resolved) {
        edges.push(makeEdge(link.sectionId ?? document.id, resolved.nodeId, "LINKS_TO", "wikilink", 0.9, now));
      }
    }
  }

  return {
    documents: dedupeById(graphDocuments),
    sections: dedupeById(sections),
    entities: dedupeById(entities),
    sourceRefs: dedupeById(sourceRefs),
    edges: dedupeEdges(edges),
    chunks: dedupeById(chunks),
    vectors: dedupeVectors(vectors)
  };
}

function addSourceRefEdges(
  document: ParsedDocument,
  paths: string[],
  kind: "IMPLEMENTS" | "REFERENCES_SOURCE",
  sourceRefs: SourceRef[],
  sourceRefByPath: Map<string, SourceRef>,
  edges: GraphEdge[],
  now: string
): void {
  for (const sourcePath of paths) {
    const sourceRef = ensureSourceRef(sourceRefs, sourceRefByPath, sourcePath, now);
    edges.push(makeEdge(document.id, sourceRef.id, kind, "frontmatter", 1, now));
  }
}

function addRelationshipEdges(
  document: ParsedDocument,
  references: string[],
  kind: "DEPENDS_ON" | "SUPERSEDES" | "DEPRECATED_BY",
  provenance: Provenance,
  resolver: LinkResolver,
  entities: GraphEntity[],
  entityByKey: Map<string, GraphEntity>,
  edges: GraphEdge[],
  now: string
): void {
  for (const reference of references) {
    const resolved = resolver.resolveDocumentRef(reference, document);
    if (resolved) {
      edges.push(makeEdge(document.id, resolved.nodeId, kind, provenance, 1, now));
      continue;
    }
    const entity = ensureEntity(entities, entityByKey, {
      name: reference,
      kind: inferEntityKind(reference)
    }, now);
    edges.push(makeEdge(document.id, entity.id, kind, provenance, 0.85, now));
  }
}

function ensureEntity(
  target: GraphEntity[],
  byKey: Map<string, GraphEntity>,
  extracted: Pick<ExtractedEntity, "name" | "kind">,
  now: string
): GraphEntity {
  const normalizedName = normalizeEntityName(extracted.name);
  const key = `${extracted.kind}:${normalizedName}`;
  const existing = byKey.get(key);
  if (existing) {
    return existing;
  }
  const entity: GraphEntity = {
    id: stableId("entity", key),
    name: extracted.name,
    normalizedName,
    kind: extracted.kind,
    createdAt: now
  };
  byKey.set(key, entity);
  target.push(entity);
  return entity;
}

function ensureSourceRef(target: SourceRef[], byPath: Map<string, SourceRef>, rawPath: string, now: string): SourceRef {
  const normalizedPath = normalizePath(rawPath.trim());
  const existing = byPath.get(normalizedPath.toLowerCase());
  if (existing) {
    return existing;
  }
  const sourceRef: SourceRef = {
    id: stableId("source_ref", normalizedPath.toLowerCase()),
    path: normalizedPath,
    normalizedPath: normalizedPath.toLowerCase(),
    createdAt: now
  };
  byPath.set(sourceRef.normalizedPath, sourceRef);
  target.push(sourceRef);
  return sourceRef;
}

function makeEdge(
  fromId: string,
  toId: string,
  kind: EdgeKind,
  provenance: Provenance,
  confidence: number,
  now: string
): GraphEdge {
  return {
    id: stableId("edge", `${fromId}:${kind}:${toId}:${provenance}`),
    fromId,
    toId,
    kind,
    weight: EDGE_WEIGHTS[kind],
    confidence,
    provenance,
    createdAt: now
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...new Map(edges.map((edge) => [`${edge.fromId}:${edge.toId}:${edge.kind}:${edge.provenance}`, edge])).values()];
}

function dedupeVectors(vectors: GraphRecordSet["vectors"]): GraphRecordSet["vectors"] {
  return [...new Map(vectors.map((vector) => [vector.chunkId, vector])).values()];
}
