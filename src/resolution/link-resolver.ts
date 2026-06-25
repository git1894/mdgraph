import path from "node:path";
import type { ParsedDocument } from "../types.js";
import { normalizePath, slugifyHeading } from "../utils/text.js";

export interface ResolvedReference {
  nodeId: string;
  documentId: string;
  sectionId?: string;
}

export class LinkResolver {
  private readonly documentAliases = new Map<string, ParsedDocument>();
  private readonly ambiguousAliases = new Set<string>();
  private readonly sectionsByDocumentAndAnchor = new Map<string, string>();

  constructor(documents: ParsedDocument[]) {
    const aliases = new Map<string, ParsedDocument[]>();

    for (const document of documents) {
      for (const alias of new Set(documentAliases(document))) {
        const candidates = aliases.get(alias) ?? [];
        candidates.push(document);
        aliases.set(alias, candidates);
      }
      for (const section of document.sections) {
        this.addSectionAnchor(document.id, section.anchor, section.id, true);
        this.addSectionAnchor(document.id, slugifyHeading(section.heading), section.id, false);
      }
    }

    for (const [alias, candidates] of aliases) {
      const uniqueCandidates = [...new Map(candidates.map((document) => [document.id, document])).values()];
      if (uniqueCandidates.length === 1) {
        this.documentAliases.set(alias, uniqueCandidates[0]);
      } else {
        this.ambiguousAliases.add(alias);
      }
    }
  }

  resolveDocumentRef(reference: string, fromDocument?: ParsedDocument, anchor?: string): ResolvedReference | undefined {
    const parsedReference = splitReferenceAnchor(reference, anchor);
    const portableReference = normalizePath(parsedReference.reference);
    const normalizedReference = normalizeReference(portableReference);
    if (!normalizedReference && !(fromDocument && parsedReference.anchor)) {
      return undefined;
    }

    const joinedReference = fromDocument && normalizedReference && isRelativeMarkdownPath(portableReference)
      ? normalizeReference(path.posix.normalize(path.posix.join(path.posix.dirname(fromDocument.relativePath), portableReference)))
      : normalizedReference;

    const document = joinedReference
      ? this.resolveAlias(joinedReference) ?? this.resolveAlias(stripMarkdownExtension(joinedReference))
      : fromDocument;
    if (!document) {
      return undefined;
    }

    const sectionId = parsedReference.anchor ? this.resolveSectionAnchor(document.id, parsedReference.anchor) : undefined;
    if (parsedReference.anchor && !sectionId) {
      return undefined;
    }
    return { nodeId: sectionId ?? document.id, documentId: document.id, sectionId };
  }

  resolveMarkdownUrl(url: string, fromDocument: ParsedDocument): ResolvedReference | undefined {
    if (/^(?:https?:|mailto:)/i.test(url)) {
      return undefined;
    }
    const [targetPath, rawAnchor] = url.split("#");
    if (!targetPath && rawAnchor) {
      const sectionId = this.resolveSectionAnchor(fromDocument.id, rawAnchor);
      return sectionId ? { nodeId: sectionId, documentId: fromDocument.id, sectionId } : undefined;
    }
    return this.resolveDocumentRef(targetPath, fromDocument, rawAnchor);
  }

  private addSectionAnchor(documentId: string, anchor: string, sectionId: string, canonical: boolean): void {
    const key = `${documentId}:${anchor}`;
    if (canonical || !this.sectionsByDocumentAndAnchor.has(key)) {
      this.sectionsByDocumentAndAnchor.set(key, sectionId);
    }
  }

  private resolveSectionAnchor(documentId: string, anchor: string): string | undefined {
    return this.sectionsByDocumentAndAnchor.get(`${documentId}:${slugifyHeading(anchor)}`);
  }

  private resolveAlias(alias: string): ParsedDocument | undefined {
    if (this.ambiguousAliases.has(alias)) {
      return undefined;
    }
    return this.documentAliases.get(alias);
  }
}

function documentAliases(document: ParsedDocument): string[] {
  const withoutExtension = stripMarkdownExtension(document.relativePath);
  const basename = path.posix.basename(withoutExtension);
  return [
    document.relativePath,
    withoutExtension,
    basename,
    document.frontmatter.id,
    document.title
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeReference);
}

function normalizeReference(value: string): string {
  return stripMarkdownExtension(normalizePath(value).trim().replace(/^\.\//, "")).toLowerCase();
}

function splitReferenceAnchor(reference: string, anchor?: string): { reference: string; anchor?: string } {
  if (anchor !== undefined) {
    return { reference, anchor };
  }
  const hashIndex = reference.indexOf("#");
  if (hashIndex < 0) {
    return { reference };
  }
  return {
    reference: reference.slice(0, hashIndex),
    anchor: reference.slice(hashIndex + 1) || undefined
  };
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(?:md|mdx)$/i, "");
}

function isRelativeMarkdownPath(value: string): boolean {
  return /^\.?\.?\//.test(value) || /\.(?:md|mdx)(?:#|$)/i.test(value);
}