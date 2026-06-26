import type { SqliteDatabase } from "./sqlite-adapter.js";
import { readSchemaMetadata, type SchemaMetadata } from "./connection.js";
import type {
  ChunkVector,
  EdgeKind,
  GraphChunk,
  GraphDocument,
  GraphEdge,
  GraphEntity,
  GraphRecordSet,
  GraphSection,
  Provenance,
  SourceRef
} from "../types.js";
import { decodeFloat32Vector, encodeFloat32Vector } from "../semantic/vector-codec.js";
import { ftsIndexContent } from "../utils/fts.js";
import { normalizePath, slugifyHeading } from "../utils/text.js";

export interface StatusCounts {
  documents: number;
  sections: number;
  entities: number;
  sourceRefs: number;
  edges: number;
  chunks: number;
  vectors: number;
}

export interface StorageObjectStat {
  name: string;
  type: string;
  category: "table" | "index" | "fts_shadow" | "other";
  rows?: number;
  bytes?: number;
}

export interface PathStorageContribution {
  group: string;
  documents: number;
  chunks: number;
  contentBytes: number;
}

export interface EdgeKindStorageStat {
  kind: EdgeKind;
  edges: number;
  averageWeight: number;
  averageConfidence: number;
}

export interface HighDegreeNodeStat {
  id: string;
  label: string;
  kind: NodeRecord["kind"] | "unknown";
  degree: number;
}

export interface VectorStorageStat {
  provider: string;
  model: string;
  dimensions: number;
  vectors: number;
}

export interface StorageDiagnostics {
  database: {
    pageSize: number;
    pageCount: number;
    freelistCount: number;
    estimatedBytes: number;
    journalMode: string;
    walCheckpoint: { available: true; busy: number; log: number; checkpointed: number } | { available: false; reason: string };
  };
  objects: {
    dbstatAvailable: boolean;
    entries: StorageObjectStat[];
  };
  pathGroups: PathStorageContribution[];
  edgeKinds: EdgeKindStorageStat[];
  highDegreeNodes: HighDegreeNodeStat[];
  vectors: {
    total: number;
    format: "float32_blob" | "legacy_json" | "unknown";
    providers: VectorStorageStat[];
  };
}

export interface ChunkSearchRow {
  document: GraphDocument;
  section?: GraphSection;
  chunk: GraphChunk;
  rank: number;
}

export interface NodeRecord {
  id: string;
  label: string;
  kind: "document" | "section" | "entity" | "source_ref" | "chunk";
  data: GraphDocument | GraphSection | GraphEntity | SourceRef | GraphChunk;
}

export interface AmbiguousNodeCandidate {
  kind: "section";
  id: string;
  documentPath: string;
  anchor: string;
  heading: string;
  line: number;
}

export type NodeResolution =
  | { status: "found"; node: NodeRecord }
  | { status: "not_found"; query: string; error: "not_found" }
  | { status: "ambiguous"; query: string; error: "ambiguous_section"; candidates: AmbiguousNodeCandidate[] };

export interface SemanticSearchRow extends ChunkSearchRow {
  similarity: number;
}

export interface DocumentLinkStats {
  document: GraphDocument;
  nonContainmentEdges: number;
  definitionEdges: number;
}

export interface DefinitionCollision {
  entity: GraphEntity;
  documents: GraphDocument[];
}

type InsertMode = "strict" | "incremental";

export class GraphRepository {
  constructor(private readonly db: SqliteDatabase) {}

  close(): void {
    this.db.close();
  }

  replaceAll(records: GraphRecordSet): void {
    const write = this.db.transaction(() => {
      this.db.exec("DELETE FROM chunks_fts; DELETE FROM chunk_vectors; DELETE FROM edges; DELETE FROM chunks; DELETE FROM source_refs; DELETE FROM entities; DELETE FROM sections; DELETE FROM documents;");
      this.insertRecords(records, "strict");
    });

    write();
    this.compactStorage({ vacuum: true });
  }

  replaceDocuments(records: GraphRecordSet, changedDocumentIds: string[], deletedDocumentIds: string[]): void {
    const write = this.db.transaction(() => {
      for (const documentId of [...changedDocumentIds, ...deletedDocumentIds]) {
        this.deleteDocumentDerivedRecords(documentId);
      }

      this.insertRecords(records, "incremental");
      this.pruneUnreferencedEntitiesAndSources();
    });

    write();
    this.compactStorage({ vacuum: false });
  }

  counts(): StatusCounts {
    return {
      documents: tableCount(this.db, "documents"),
      sections: tableCount(this.db, "sections"),
      entities: tableCount(this.db, "entities"),
      sourceRefs: tableCount(this.db, "source_refs"),
      edges: tableCount(this.db, "edges"),
      chunks: tableCount(this.db, "chunks"),
      vectors: tableCount(this.db, "chunk_vectors")
    };
  }

  latestIndexedAt(): string | undefined {
    const row = this.db.prepare("SELECT MAX(indexed_at) AS indexed_at FROM documents").get() as Record<string, unknown> | undefined;
    return typeof row?.indexed_at === "string" && row.indexed_at ? row.indexed_at : undefined;
  }

  schemaMetadata(): SchemaMetadata {
    return readSchemaMetadata(this.db);
  }

  storageDiagnostics(): StorageDiagnostics {
    const pageSize = pragmaNumber(this.db, "page_size");
    const pageCount = pragmaNumber(this.db, "page_count");
    const freelistCount = pragmaNumber(this.db, "freelist_count");
    const objectSizes = objectStorageStats(this.db);
    const providers = vectorStorageStats(this.db);

    return {
      database: {
        pageSize,
        pageCount,
        freelistCount,
        estimatedBytes: pageSize * pageCount,
        journalMode: pragmaString(this.db, "journal_mode"),
        walCheckpoint: walCheckpointStats(this.db)
      },
      objects: objectSizes,
      pathGroups: pathStorageContributions(this.db),
      edgeKinds: edgeKindStorageStats(this.db),
      highDegreeNodes: highDegreeNodeStats(this.db, (id) => this.getNode(id)),
      vectors: {
        total: tableCount(this.db, "chunk_vectors"),
        format: vectorStorageFormat(this.db),
        providers
      }
    };
  }

  checkpointStorage(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }

  documentHashes(): Map<string, { id: string; hash: string }> {
    const rows = this.db.prepare("SELECT id, path, hash FROM documents").all() as Record<string, unknown>[];
    return new Map(rows.map((row) => [stringValue(row.path), { id: stringValue(row.id), hash: stringValue(row.hash) }]));
  }

  searchChunks(ftsQuery: string, limit: number): ChunkSearchRow[] {
    const rows = this.db.prepare(`
      SELECT
        d.id AS d_id, d.path AS d_path, d.title AS d_title, d.type AS d_type, d.status AS d_status,
        d.hash AS d_hash, d.trust_tier AS d_trust_tier, d.updated_at AS d_updated_at,
        d.indexed_at AS d_indexed_at, d.metadata_json AS d_metadata_json,
        s.id AS s_id, s.document_id AS s_document_id, s.anchor AS s_anchor, s.heading AS s_heading,
        s.level AS s_level, s.start_line AS s_start_line, s.end_line AS s_end_line, s.content AS s_content,
        c.id AS c_id, c.document_id AS c_document_id, c.section_id AS c_section_id, c.content AS c_content,
        c.token_estimate AS c_token_estimate, c.metadata_json AS c_metadata_json,
        bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.rowid = chunks_fts.rowid
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN sections s ON s.id = c.section_id
      WHERE chunks_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(ftsQuery, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      document: rowToDocument(row, "d_"),
      section: row.s_id ? rowToSection(row, "s_") : undefined,
      chunk: rowToChunk(row, "c_"),
      rank: numberValue(row.rank)
    }));
  }

  findEntitiesByNormalizedNames(names: string[]): GraphEntity[] {
    if (!names.length) {
      return [];
    }
    const statement = this.db.prepare("SELECT * FROM entities WHERE normalized_name = ?");
    return names.flatMap((name) => (statement.all(name) as Record<string, unknown>[]).map(rowToEntity));
  }

  entityDocumentFrequencies(entityIds: string[]): Map<string, number> {
    const frequencies = new Map<string, number>();
    if (!entityIds.length) {
      return frequencies;
    }
    const statement = this.db.prepare(`
      WITH related_documents(document_id) AS (
        SELECT document.id
        FROM edges edge
        JOIN documents document ON document.id = edge.from_id
        WHERE edge.to_id = ? AND edge.kind <> 'CONTAINS'
        UNION
        SELECT section.document_id
        FROM edges edge
        JOIN sections section ON section.id = edge.from_id
        WHERE edge.to_id = ? AND edge.kind <> 'CONTAINS'
        UNION
        SELECT chunk.document_id
        FROM edges edge
        JOIN chunks chunk ON chunk.id = edge.from_id
        WHERE edge.to_id = ? AND edge.kind <> 'CONTAINS'
        UNION
        SELECT document.id
        FROM edges edge
        JOIN documents document ON document.id = edge.to_id
        WHERE edge.from_id = ? AND edge.kind <> 'CONTAINS'
        UNION
        SELECT section.document_id
        FROM edges edge
        JOIN sections section ON section.id = edge.to_id
        WHERE edge.from_id = ? AND edge.kind <> 'CONTAINS'
        UNION
        SELECT chunk.document_id
        FROM edges edge
        JOIN chunks chunk ON chunk.id = edge.to_id
        WHERE edge.from_id = ? AND edge.kind <> 'CONTAINS'
      )
      SELECT count(DISTINCT document_id) AS count FROM related_documents
    `);
    for (const entityId of entityIds) {
      const row = statement.get(entityId, entityId, entityId, entityId, entityId, entityId) as { count: number };
      frequencies.set(entityId, row.count);
    }
    return frequencies;
  }

  findEntityDefinitions(entityIds: string[]): ChunkSearchRow[] {
    if (!entityIds.length) {
      return [];
    }
    const statement = this.db.prepare(`
      SELECT
        d.id AS d_id, d.path AS d_path, d.title AS d_title, d.type AS d_type, d.status AS d_status,
        d.hash AS d_hash, d.trust_tier AS d_trust_tier, d.updated_at AS d_updated_at,
        d.indexed_at AS d_indexed_at, d.metadata_json AS d_metadata_json,
        s.id AS s_id, s.document_id AS s_document_id, s.anchor AS s_anchor, s.heading AS s_heading,
        s.level AS s_level, s.start_line AS s_start_line, s.end_line AS s_end_line, s.content AS s_content,
        e.weight AS rank
      FROM edges e
      LEFT JOIN sections s ON s.id = e.from_id
      JOIN documents d ON d.id = COALESCE(s.document_id, e.from_id)
      WHERE e.kind = 'DEFINES' AND e.to_id = ?
      ORDER BY e.weight DESC, d.path ASC, s.start_line ASC, e.id ASC
      LIMIT 3
    `);
    const sectionChunk = this.db.prepare("SELECT * FROM chunks WHERE section_id = ? ORDER BY id LIMIT 1");
    const documentChunk = this.db.prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY id LIMIT 1");
    return entityIds.flatMap((entityId) => (statement.all(entityId) as Record<string, unknown>[]).map((row) => ({
      document: rowToDocument(row, "d_"),
      section: row.s_id ? rowToSection(row, "s_") : undefined,
      chunk: definitionChunk(row, sectionChunk, documentChunk),
      rank: numberValue(row.rank)
    })));
  }

  searchSemanticChunks(queryVector: number[], provider: string, model: string, limit: number): SemanticSearchRow[] {
    const rows = this.db.prepare(`
      SELECT
        d.id AS d_id, d.path AS d_path, d.title AS d_title, d.type AS d_type, d.status AS d_status,
        d.hash AS d_hash, d.trust_tier AS d_trust_tier, d.updated_at AS d_updated_at,
        d.indexed_at AS d_indexed_at, d.metadata_json AS d_metadata_json,
        s.id AS s_id, s.document_id AS s_document_id, s.anchor AS s_anchor, s.heading AS s_heading,
        s.level AS s_level, s.start_line AS s_start_line, s.end_line AS s_end_line, s.content AS s_content,
        c.id AS c_id, c.document_id AS c_document_id, c.section_id AS c_section_id, c.content AS c_content,
        c.token_estimate AS c_token_estimate, c.metadata_json AS c_metadata_json,
        v.vector_blob AS vector_blob
      FROM chunk_vectors v
      JOIN chunks c ON c.id = v.chunk_id
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN sections s ON s.id = c.section_id
      WHERE v.provider = ? AND v.model = ?
    `).all(provider, model) as Record<string, unknown>[];

    return rows
      .map((row) => ({
        document: rowToDocument(row, "d_"),
        section: row.s_id ? rowToSection(row, "s_") : undefined,
        chunk: rowToChunk(row, "c_"),
        rank: 0,
        similarity: cosine(queryVector, decodeFloat32Vector(row.vector_blob))
      }))
      .filter((row) => row.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  contextChunkForNode(id: string): ChunkSearchRow | undefined {
    const chunkRow = this.db.prepare(`
      SELECT
        d.id AS d_id, d.path AS d_path, d.title AS d_title, d.type AS d_type, d.status AS d_status,
        d.hash AS d_hash, d.trust_tier AS d_trust_tier, d.updated_at AS d_updated_at,
        d.indexed_at AS d_indexed_at, d.metadata_json AS d_metadata_json,
        s.id AS s_id, s.document_id AS s_document_id, s.anchor AS s_anchor, s.heading AS s_heading,
        s.level AS s_level, s.start_line AS s_start_line, s.end_line AS s_end_line, s.content AS s_content,
        c.id AS c_id, c.document_id AS c_document_id, c.section_id AS c_section_id, c.content AS c_content,
        c.token_estimate AS c_token_estimate, c.metadata_json AS c_metadata_json,
        0 AS rank
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN sections s ON s.id = c.section_id
      WHERE c.id = ?
      LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    if (chunkRow) {
      return rowToChunkSearchRow(chunkRow);
    }

    const sectionRow = this.db.prepare(`
      SELECT
        d.id AS d_id, d.path AS d_path, d.title AS d_title, d.type AS d_type, d.status AS d_status,
        d.hash AS d_hash, d.trust_tier AS d_trust_tier, d.updated_at AS d_updated_at,
        d.indexed_at AS d_indexed_at, d.metadata_json AS d_metadata_json,
        s.id AS s_id, s.document_id AS s_document_id, s.anchor AS s_anchor, s.heading AS s_heading,
        s.level AS s_level, s.start_line AS s_start_line, s.end_line AS s_end_line, s.content AS s_content,
        c.id AS c_id, c.document_id AS c_document_id, c.section_id AS c_section_id, c.content AS c_content,
        c.token_estimate AS c_token_estimate, c.metadata_json AS c_metadata_json,
        0 AS rank
      FROM sections s
      JOIN documents d ON d.id = s.document_id
      JOIN chunks c ON c.section_id = s.id
      WHERE s.id = ?
      ORDER BY c.id
      LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    if (sectionRow) {
      return rowToChunkSearchRow(sectionRow);
    }

    const documentRow = this.db.prepare(`
      SELECT
        d.id AS d_id, d.path AS d_path, d.title AS d_title, d.type AS d_type, d.status AS d_status,
        d.hash AS d_hash, d.trust_tier AS d_trust_tier, d.updated_at AS d_updated_at,
        d.indexed_at AS d_indexed_at, d.metadata_json AS d_metadata_json,
        s.id AS s_id, s.document_id AS s_document_id, s.anchor AS s_anchor, s.heading AS s_heading,
        s.level AS s_level, s.start_line AS s_start_line, s.end_line AS s_end_line, s.content AS s_content,
        c.id AS c_id, c.document_id AS c_document_id, c.section_id AS c_section_id, c.content AS c_content,
        c.token_estimate AS c_token_estimate, c.metadata_json AS c_metadata_json,
        0 AS rank
      FROM documents d
      JOIN chunks c ON c.document_id = d.id
      LEFT JOIN sections s ON s.id = c.section_id
      WHERE d.id = ?
      ORDER BY s.start_line ASC, c.id ASC
      LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;

    return documentRow ? rowToChunkSearchRow(documentRow) : undefined;
  }

  resolveNode(query: string): NodeRecord | undefined {
    const resolution = this.resolveNodeDetailed(query);
    return resolution.status === "found" ? resolution.node : undefined;
  }

  resolveNodeDetailed(query: string): NodeResolution {
    const trimmed = query.trim();
    if (!trimmed) {
      return { status: "not_found", query, error: "not_found" };
    }

    const direct = this.getNode(trimmed);
    if (direct) {
      return { status: "found", node: direct };
    }

    const pathAnchor = this.resolveSectionByPathAnchor(trimmed);
    if (pathAnchor) {
      return { status: "found", node: pathAnchor };
    }

    const normalized = trimmed.toLowerCase();
    const document = this.db.prepare("SELECT * FROM documents WHERE lower(path) = ? OR lower(title) = ? OR id = ? ORDER BY path, id LIMIT 1").get(normalized, normalized, query) as Record<string, unknown> | undefined;
    if (document) {
      const data = rowToDocument(document);
      return { status: "found", node: { id: data.id, label: data.title, kind: "document", data } };
    }

    const sourceRef = this.db.prepare("SELECT * FROM source_refs WHERE normalized_path = ? OR id = ? ORDER BY path, id LIMIT 1").get(normalized, query) as Record<string, unknown> | undefined;
    if (sourceRef) {
      const data = rowToSourceRef(sourceRef);
      return { status: "found", node: { id: data.id, label: data.path, kind: "source_ref", data } };
    }

    const section = this.resolveSectionByHeading(trimmed);
    if (section.status !== "not_found") {
      return section;
    }

    const entity = this.db.prepare("SELECT * FROM entities WHERE normalized_name = ? OR id = ? ORDER BY kind, id LIMIT 1").get(normalized, query) as Record<string, unknown> | undefined;
    if (entity) {
      const data = rowToEntity(entity);
      return { status: "found", node: { id: data.id, label: data.name, kind: "entity", data } };
    }

    return section;
  }

  getNode(id: string): NodeRecord | undefined {
    const probes: Array<[NodeRecord["kind"], string, (row: Record<string, unknown>) => NodeRecord]> = [
      ["document", "SELECT * FROM documents WHERE id = ?", (row) => {
        const data = rowToDocument(row);
        return { id: data.id, label: data.title, kind: "document", data };
      }],
      ["section", "SELECT * FROM sections WHERE id = ?", (row) => {
        const data = rowToSection(row);
        return { id: data.id, label: data.heading, kind: "section", data };
      }],
      ["entity", "SELECT * FROM entities WHERE id = ?", (row) => {
        const data = rowToEntity(row);
        return { id: data.id, label: data.name, kind: "entity", data };
      }],
      ["source_ref", "SELECT * FROM source_refs WHERE id = ?", (row) => {
        const data = rowToSourceRef(row);
        return { id: data.id, label: data.path, kind: "source_ref", data };
      }],
      ["chunk", "SELECT * FROM chunks WHERE id = ?", (row) => {
        const data = rowToChunk(row);
        return { id: data.id, label: data.id, kind: "chunk", data };
      }]
    ];

    for (const [, sql, map] of probes) {
      const row = this.db.prepare(sql).get(id) as Record<string, unknown> | undefined;
      if (row) {
        return map(row);
      }
    }
    return undefined;
  }

  edgesForNode(id: string): GraphEdge[] {
    const rows = this.db.prepare("SELECT * FROM edges WHERE from_id = ? OR to_id = ? ORDER BY weight DESC, confidence DESC").all(id, id) as Record<string, unknown>[];
    return rows.map(rowToEdge);
  }

  private resolveSectionByPathAnchor(query: string): NodeRecord | undefined {
    const hashIndex = query.indexOf("#");
    if (hashIndex < 0) {
      return undefined;
    }
    const rawPath = normalizePath(query.slice(0, hashIndex).trim()).replace(/^\.\//, "").toLowerCase();
    const rawAnchor = query.slice(hashIndex + 1).trim();
    if (!rawPath || !rawAnchor) {
      return undefined;
    }

    const pathCandidates = sectionPathCandidates(rawPath);
    const placeholders = pathCandidates.map(() => "?").join(", ");
    const row = this.db.prepare(`
      SELECT s.*
      FROM sections s
      JOIN documents d ON d.id = s.document_id
      WHERE lower(d.path) IN (${placeholders}) AND lower(s.anchor) = ?
      ORDER BY d.path ASC, s.start_line ASC, s.id ASC
      LIMIT 1
    `).get(...pathCandidates, slugifyHeading(rawAnchor)) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }
    const data = rowToSection(row);
    return { id: data.id, label: data.heading, kind: "section", data };
  }

  private resolveSectionByHeading(query: string): NodeResolution {
    const normalizedHeading = query.trim().toLowerCase();
    const normalizedAnchor = slugifyHeading(query);
    const rows = this.db.prepare(`
      SELECT d.path AS document_path, s.*
      FROM sections s
      JOIN documents d ON d.id = s.document_id
      WHERE lower(s.heading) = ? OR lower(s.anchor) = ?
      ORDER BY d.path ASC, s.start_line ASC, s.id ASC
    `).all(normalizedHeading, normalizedAnchor) as Record<string, unknown>[];

    if (rows.length === 0) {
      return { status: "not_found", query, error: "not_found" };
    }
    if (rows.length === 1) {
      const data = rowToSection(rows[0]);
      return { status: "found", node: { id: data.id, label: data.heading, kind: "section", data } };
    }
    return {
      status: "ambiguous",
      query,
      error: "ambiguous_section",
      candidates: rows.map((row) => {
        const section = rowToSection(row);
        return {
          kind: "section",
          id: section.id,
          documentPath: stringValue(row.document_path),
          anchor: section.anchor,
          heading: section.heading,
          line: section.startLine
        };
      })
    };
  }

  edgesFromNode(id: string): GraphEdge[] {
    const rows = this.db.prepare("SELECT * FROM edges WHERE from_id = ? ORDER BY weight DESC, confidence DESC").all(id) as Record<string, unknown>[];
    return rows.map(rowToEdge);
  }

  allDocuments(): GraphDocument[] {
    const rows = this.db.prepare("SELECT * FROM documents ORDER BY path").all() as Record<string, unknown>[];
    return rows.map((row) => rowToDocument(row));
  }

  allSections(): GraphSection[] {
    const rows = this.db.prepare("SELECT * FROM sections ORDER BY document_id, start_line, id").all() as Record<string, unknown>[];
    return rows.map((row) => rowToSection(row));
  }

  allEntities(): GraphEntity[] {
    const rows = this.db.prepare("SELECT * FROM entities ORDER BY kind, normalized_name, id").all() as Record<string, unknown>[];
    return rows.map(rowToEntity);
  }

  allSourceRefs(): SourceRef[] {
    const rows = this.db.prepare("SELECT * FROM source_refs ORDER BY path").all() as Record<string, unknown>[];
    return rows.map(rowToSourceRef);
  }

  allEdges(): GraphEdge[] {
    const rows = this.db.prepare("SELECT * FROM edges ORDER BY from_id, to_id, kind, provenance").all() as Record<string, unknown>[];
    return rows.map(rowToEdge);
  }

  documentLinkStats(): DocumentLinkStats[] {
    const documents = this.allDocuments();
    const statement = this.db.prepare(`
      SELECT
        SUM(CASE WHEN e.kind <> 'CONTAINS' THEN 1 ELSE 0 END) AS non_containment_edges,
        SUM(CASE WHEN e.kind = 'DEFINES' THEN 1 ELSE 0 END) AS definition_edges
      FROM documents d
      LEFT JOIN sections s ON s.document_id = d.id
      LEFT JOIN chunks c ON c.document_id = d.id
      LEFT JOIN edges e ON e.from_id IN (d.id, s.id, c.id) OR e.to_id IN (d.id, s.id, c.id)
      WHERE d.id = ?
    `);

    return documents.map((document) => {
      const row = statement.get(document.id) as Record<string, unknown> | undefined;
      return {
        document,
        nonContainmentEdges: numberValue(row?.non_containment_edges),
        definitionEdges: numberValue(row?.definition_edges)
      };
    });
  }

  definitionCollisions(): DefinitionCollision[] {
    const collisionRows = this.db.prepare(`
      SELECT edge.to_id AS entity_id
      FROM edges edge
      JOIN entities entity ON entity.id = edge.to_id
      LEFT JOIN sections section ON section.id = edge.from_id
      JOIN documents document ON document.id = COALESCE(section.document_id, edge.from_id)
      WHERE edge.kind = 'DEFINES' AND document.status = 'active'
      GROUP BY edge.to_id
      HAVING COUNT(DISTINCT document.id) > 1
    `).all() as Record<string, unknown>[];
    const entityStatement = this.db.prepare("SELECT * FROM entities WHERE id = ?");
    const documentsStatement = this.db.prepare(`
      SELECT DISTINCT document.*
      FROM edges edge
      LEFT JOIN sections section ON section.id = edge.from_id
      JOIN documents document ON document.id = COALESCE(section.document_id, edge.from_id)
      WHERE edge.kind = 'DEFINES' AND edge.to_id = ? AND document.status = 'active'
      ORDER BY document.path
    `);

    return collisionRows.map((row) => ({
      entity: rowToEntity(entityStatement.get(row.entity_id) as Record<string, unknown>),
      documents: (documentsStatement.all(row.entity_id) as Record<string, unknown>[]).map((documentRow) => rowToDocument(documentRow))
    }));
  }

  private insertRecords(records: GraphRecordSet, mode: InsertMode): void {
    const entityInsert = mode === "incremental" ? "INSERT OR IGNORE" : "INSERT";
    const sourceRefInsert = mode === "incremental" ? "INSERT OR IGNORE" : "INSERT";
    const edgeInsert = mode === "incremental" ? "INSERT OR REPLACE" : "INSERT";
    const insertDocument = this.db.prepare(`
      INSERT INTO documents (id, path, title, type, status, hash, trust_tier, updated_at, indexed_at, metadata_json)
      VALUES (@id, @path, @title, @type, @status, @hash, @trustTier, @updatedAt, @indexedAt, @metadataJson)
    `);
    const insertSection = this.db.prepare(`
      INSERT INTO sections (id, document_id, anchor, heading, level, start_line, end_line, content)
      VALUES (@id, @documentId, @anchor, @heading, @level, @startLine, @endLine, @content)
    `);
    const insertEntity = this.db.prepare(`
      ${entityInsert} INTO entities (id, name, normalized_name, kind, namespace, created_at, metadata_json)
      VALUES (@id, @name, @normalizedName, @kind, @namespace, @createdAt, @metadataJson)
    `);
    const insertSourceRef = this.db.prepare(`
      ${sourceRefInsert} INTO source_refs (id, path, normalized_path, created_at, metadata_json)
      VALUES (@id, @path, @normalizedPath, @createdAt, @metadataJson)
    `);
    const insertEdge = this.db.prepare(`
      ${edgeInsert} INTO edges (id, from_id, to_id, kind, weight, confidence, provenance, metadata_json, created_at)
      VALUES (@id, @fromId, @toId, @kind, @weight, @confidence, @provenance, @metadataJson, @createdAt)
    `);
    const insertChunk = this.db.prepare(`
      INSERT INTO chunks (id, document_id, section_id, content, token_estimate, metadata_json)
      VALUES (@id, @documentId, @sectionId, @content, @tokenEstimate, @metadataJson)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO chunks_fts (rowid, content)
      VALUES (@rowid, @content)
    `);
    const insertVector = this.prepareInsertVector();

    for (const document of records.documents) {
      insertDocument.run({
        id: document.id,
        path: document.path,
        title: document.title,
        type: document.type,
        status: document.status,
        hash: document.hash,
        trustTier: document.trustTier,
        updatedAt: document.updatedAt ?? null,
        indexedAt: document.indexedAt,
        metadataJson: toJson(document.metadata)
      });
    }
    for (const section of records.sections) {
      insertSection.run(section);
    }
    for (const entity of records.entities) {
      insertEntity.run({
        id: entity.id,
        name: entity.name,
        normalizedName: entity.normalizedName,
        kind: entity.kind,
        namespace: entity.namespace ?? null,
        createdAt: entity.createdAt,
        metadataJson: toJson(entity.metadata)
      });
    }
    for (const sourceRef of records.sourceRefs) {
      insertSourceRef.run({
        id: sourceRef.id,
        path: sourceRef.path,
        normalizedPath: sourceRef.normalizedPath,
        createdAt: sourceRef.createdAt,
        metadataJson: toJson(sourceRef.metadata)
      });
    }
    for (const edge of records.edges) {
      insertEdge.run({
        id: edge.id,
        fromId: edge.fromId,
        toId: edge.toId,
        kind: edge.kind,
        weight: edge.weight,
        confidence: edge.confidence,
        provenance: edge.provenance,
        metadataJson: toJson(edge.metadata),
        createdAt: edge.createdAt
      });
    }
    for (const chunk of records.chunks) {
      const result = insertChunk.run({
        id: chunk.id,
        documentId: chunk.documentId,
        sectionId: chunk.sectionId ?? null,
        content: chunk.content,
        tokenEstimate: chunk.tokenEstimate,
        metadataJson: toJson(chunk.metadata)
      });
      insertFts.run({
        rowid: result.lastInsertRowid,
        content: ftsIndexContent(chunk.content)
      });
    }
    for (const vector of records.vectors) {
      insertVector.run(vectorToParams(vector));
    }
  }

  private prepareInsertVector() {
    return this.db.prepare(`
      INSERT INTO chunk_vectors (chunk_id, provider, model, dimensions, vector_blob, created_at)
      VALUES (@chunkId, @provider, @model, @dimensions, @vectorBlob, @createdAt)
    `);
  }

  private deleteDocumentDerivedRecords(documentId: string): void {
    const chunkRows = this.db.prepare("SELECT rowid, content FROM chunks WHERE document_id = ?").all(documentId) as Array<{ rowid: number | bigint; content: string }>;
    const deleteFts = this.db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES (@operation, @rowid, @content)");
    for (const row of chunkRows) {
      deleteFts.run({ operation: "delete", rowid: row.rowid, content: ftsIndexContent(row.content) });
    }

    const nodeRows = this.db.prepare(`
      SELECT id FROM documents WHERE id = ?
      UNION SELECT id FROM sections WHERE document_id = ?
      UNION SELECT id FROM chunks WHERE document_id = ?
    `).all(documentId, documentId, documentId) as Array<{ id: string }>;
    const deleteEdges = this.db.prepare("DELETE FROM edges WHERE from_id = ? OR to_id = ?");

    for (const row of nodeRows) {
      deleteEdges.run(row.id, row.id);
    }

    this.db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
  }

  private pruneUnreferencedEntitiesAndSources(): void {
    this.db.exec(`
      DELETE FROM entities
      WHERE id NOT IN (SELECT from_id FROM edges UNION SELECT to_id FROM edges);
      DELETE FROM source_refs
      WHERE id NOT IN (SELECT from_id FROM edges UNION SELECT to_id FROM edges);
    `);
  }

  private compactStorage(options: { vacuum: boolean }): void {
    this.db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize');");
    this.db.exec("PRAGMA optimize;");
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    if (options.vacuum) {
      this.db.exec("VACUUM;");
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    }
  }
}

function definitionChunk(
  row: Record<string, unknown>,
  sectionChunk: ReturnType<SqliteDatabase["prepare"]>,
  documentChunk: ReturnType<SqliteDatabase["prepare"]>
): GraphChunk {
  const sectionChunkRow = row.s_id ? sectionChunk.get(row.s_id) as Record<string, unknown> | undefined : undefined;
  const chunkRow = sectionChunkRow ?? documentChunk.get(row.d_id) as Record<string, unknown> | undefined;
  return chunkRow ? rowToChunk(chunkRow) : {
    id: `${row.d_id}:document`,
    documentId: stringValue(row.d_id),
    content: stringValue(row.d_title),
    tokenEstimate: 1
  };
}

function sectionPathCandidates(rawPath: string): string[] {
  const withoutExtension = rawPath.replace(/\.(?:md|mdx)$/i, "");
  return [...new Set([rawPath, `${withoutExtension}.md`, `${withoutExtension}.mdx`])];
}

function tableCount(db: SqliteDatabase, table: keyof typeof countStatements): number {
  const row = db.prepare(countStatements[table]).get() as { count: number };
  return row.count;
}

function objectStorageStats(db: SqliteDatabase): StorageDiagnostics["objects"] {
  const schemaRows = db.prepare(`
    SELECT name, type
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string; type: string }>;
  const sizes = dbstatSizes(db);
  const entries = schemaRows.map((row) => ({
    name: row.name,
    type: row.type,
    category: objectCategory(row.name, row.type),
    rows: row.type === "table" ? safeObjectRowCount(db, row.name) : undefined,
    bytes: sizes.get(row.name)
  }));
  return {
    dbstatAvailable: sizes.size > 0,
    entries
  };
}

function dbstatSizes(db: SqliteDatabase): Map<string, number> {
  try {
    const rows = db.prepare(`
      SELECT name, SUM(pgsize) AS bytes
      FROM dbstat
      GROUP BY name
    `).all() as Array<{ name: string; bytes: number }>;
    return new Map(rows.map((row) => [row.name, Number(row.bytes)]));
  } catch {
    return new Map();
  }
}

function safeObjectRowCount(db: SqliteDatabase, name: string): number | undefined {
  try {
    const row = db.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(name)}`).get() as { count: number };
    return row.count;
  } catch {
    return undefined;
  }
}

function pathStorageContributions(db: SqliteDatabase): PathStorageContribution[] {
  const rows = db.prepare(`
    SELECT
      d.path AS path,
      COUNT(DISTINCT c.id) AS chunks,
      COALESCE(SUM(LENGTH(c.content)), 0) AS content_chars
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY d.id, d.path
    ORDER BY d.path
  `).all() as Array<{ path: string; chunks: number; content_chars: number }>;
  const byGroup = new Map<string, PathStorageContribution>();

  for (const row of rows) {
    const group = pathGroup(row.path);
    const current = byGroup.get(group) ?? { group, documents: 0, chunks: 0, contentBytes: 0 };
    byGroup.set(group, {
      group,
      documents: current.documents + 1,
      chunks: current.chunks + Number(row.chunks),
      contentBytes: current.contentBytes + Buffer.byteLength(row.path, "utf8") + Number(row.content_chars)
    });
  }

  return [...byGroup.values()].sort((left, right) => right.contentBytes - left.contentBytes || left.group.localeCompare(right.group));
}

function edgeKindStorageStats(db: SqliteDatabase): EdgeKindStorageStat[] {
  const rows = db.prepare(`
    SELECT kind, COUNT(*) AS edges, AVG(weight) AS average_weight, AVG(confidence) AS average_confidence
    FROM edges
    GROUP BY kind
    ORDER BY edges DESC, kind ASC
  `).all() as Array<{ kind: string; edges: number; average_weight: number; average_confidence: number }>;
  return rows.map((row) => ({
    kind: row.kind as EdgeKind,
    edges: Number(row.edges),
    averageWeight: Number(row.average_weight),
    averageConfidence: Number(row.average_confidence)
  }));
}

function highDegreeNodeStats(db: SqliteDatabase, resolveNode: (id: string) => NodeRecord | undefined): HighDegreeNodeStat[] {
  const rows = db.prepare(`
    WITH endpoints(id) AS (
      SELECT from_id FROM edges WHERE kind <> 'CONTAINS'
      UNION ALL
      SELECT to_id FROM edges WHERE kind <> 'CONTAINS'
    )
    SELECT id, COUNT(*) AS degree
    FROM endpoints
    GROUP BY id
    ORDER BY degree DESC, id ASC
    LIMIT 10
  `).all() as Array<{ id: string; degree: number }>;
  return rows.map((row) => {
    const node = resolveNode(row.id);
    return {
      id: row.id,
      label: node?.label ?? row.id,
      kind: node?.kind ?? "unknown",
      degree: Number(row.degree)
    };
  });
}

function vectorStorageStats(db: SqliteDatabase): VectorStorageStat[] {
  const rows = db.prepare(`
    SELECT provider, model, dimensions, COUNT(*) AS vectors
    FROM chunk_vectors
    GROUP BY provider, model, dimensions
    ORDER BY vectors DESC, provider ASC, model ASC, dimensions ASC
  `).all() as Array<{ provider: string; model: string; dimensions: number; vectors: number }>;
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    dimensions: Number(row.dimensions),
    vectors: Number(row.vectors)
  }));
}

function vectorStorageFormat(db: SqliteDatabase): StorageDiagnostics["vectors"]["format"] {
  const columns = new Set((db.prepare("PRAGMA table_info(chunk_vectors)").all() as Array<{ name: string }>).map((row) => row.name));
  if (columns.has("vector_blob")) {
    return "float32_blob";
  }
  if (columns.has("vector_json")) {
    return "legacy_json";
  }
  return "unknown";
}

function walCheckpointStats(db: SqliteDatabase): StorageDiagnostics["database"]["walCheckpoint"] {
  try {
    const row = db.pragma("wal_checkpoint(PASSIVE)") as Record<string, unknown> | undefined;
    return {
      available: true,
      busy: numberValue(row?.busy),
      log: numberValue(row?.log),
      checkpointed: numberValue(row?.checkpointed)
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function pragmaNumber(db: SqliteDatabase, name: string): number {
  return numberValue(db.pragma(name, { simple: true }));
}

function pragmaString(db: SqliteDatabase, name: string): string {
  return stringValue(db.pragma(name, { simple: true }));
}

function objectCategory(name: string, type: string): StorageObjectStat["category"] {
  if (name.startsWith("chunks_fts_")) {
    return "fts_shadow";
  }
  if (type === "table" || type === "index") {
    return type;
  }
  return "other";
}

function pathGroup(documentPath: string): string {
  const normalized = normalizePath(documentPath).replace(/^\.\//, "");
  const slash = normalized.indexOf("/");
  return slash === -1 ? "." : normalized.slice(0, slash);
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

const countStatements = {
  documents: "SELECT count(*) AS count FROM documents",
  sections: "SELECT count(*) AS count FROM sections",
  entities: "SELECT count(*) AS count FROM entities",
  source_refs: "SELECT count(*) AS count FROM source_refs",
  edges: "SELECT count(*) AS count FROM edges",
  chunks: "SELECT count(*) AS count FROM chunks",
  chunk_vectors: "SELECT count(*) AS count FROM chunk_vectors"
} as const;

function rowToDocument(row: Record<string, unknown>, prefix = ""): GraphDocument {
  return {
    id: stringValue(row[`${prefix}id`]),
    path: stringValue(row[`${prefix}path`]),
    title: stringValue(row[`${prefix}title`]),
    type: stringValue(row[`${prefix}type`]) as GraphDocument["type"],
    status: stringValue(row[`${prefix}status`]),
    hash: stringValue(row[`${prefix}hash`]),
    trustTier: stringValue(row[`${prefix}trust_tier`]) as GraphDocument["trustTier"],
    updatedAt: optionalString(row[`${prefix}updated_at`]),
    indexedAt: stringValue(row[`${prefix}indexed_at`]),
    metadata: fromJson(row[`${prefix}metadata_json`])
  };
}

function rowToSection(row: Record<string, unknown>, prefix = ""): GraphSection {
  return {
    id: stringValue(row[`${prefix}id`]),
    documentId: stringValue(row[`${prefix}document_id`]),
    anchor: stringValue(row[`${prefix}anchor`]),
    heading: stringValue(row[`${prefix}heading`]),
    level: numberValue(row[`${prefix}level`]),
    startLine: numberValue(row[`${prefix}start_line`]),
    endLine: numberValue(row[`${prefix}end_line`]),
    content: stringValue(row[`${prefix}content`])
  };
}

function rowToEntity(row: Record<string, unknown>): GraphEntity {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    normalizedName: stringValue(row.normalized_name),
    kind: stringValue(row.kind) as GraphEntity["kind"],
    namespace: optionalString(row.namespace),
    createdAt: stringValue(row.created_at),
    metadata: fromJson(row.metadata_json)
  };
}

function rowToSourceRef(row: Record<string, unknown>): SourceRef {
  return {
    id: stringValue(row.id),
    path: stringValue(row.path),
    normalizedPath: stringValue(row.normalized_path),
    createdAt: stringValue(row.created_at),
    metadata: fromJson(row.metadata_json)
  };
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: stringValue(row.id),
    fromId: stringValue(row.from_id),
    toId: stringValue(row.to_id),
    kind: stringValue(row.kind) as EdgeKind,
    weight: numberValue(row.weight),
    confidence: numberValue(row.confidence),
    provenance: stringValue(row.provenance) as Provenance,
    metadata: fromJson(row.metadata_json),
    createdAt: stringValue(row.created_at)
  };
}

function rowToChunk(row: Record<string, unknown>, prefix = ""): GraphChunk {
  return {
    id: stringValue(row[`${prefix}id`]),
    documentId: stringValue(row[`${prefix}document_id`]),
    sectionId: optionalString(row[`${prefix}section_id`]),
    content: stringValue(row[`${prefix}content`]),
    tokenEstimate: numberValue(row[`${prefix}token_estimate`]),
    metadata: fromJson(row[`${prefix}metadata_json`])
  };
}

function rowToChunkSearchRow(row: Record<string, unknown>): ChunkSearchRow {
  return {
    document: rowToDocument(row, "d_"),
    section: row.s_id ? rowToSection(row, "s_") : undefined,
    chunk: rowToChunk(row, "c_"),
    rank: numberValue(row.rank)
  };
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function vectorToParams(vector: ChunkVector): Record<string, unknown> {
  return {
    chunkId: vector.chunkId,
    provider: vector.provider,
    model: vector.model,
    dimensions: vector.dimensions,
    vectorBlob: encodeFloat32Vector(vector.vector),
    createdAt: vector.createdAt
  };
}

function cosine(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function fromJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  return JSON.parse(value) as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}
