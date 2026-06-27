import fs from "node:fs";
import path from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { PARSER_LIMITS } from "../config/limits.js";
import type { CodeSnippet, MarkdownLink, ParsedDocument, ParsedSection, WikiLink } from "../types.js";
import { contentHash, stableId } from "../utils/id.js";
import { assertInsideRoot } from "../utils/path-safety.js";
import { relativeUnixPath, slugifyHeading } from "../utils/text.js";
import { normalizeFrontmatter, parseFrontmatterBlock } from "./frontmatter.js";
import { parseWikiLinkTarget } from "./links.js";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  depth?: number;
  lang?: string;
  children?: MdastNode[];
  position?: {
    start: { line: number; column?: number };
    end: { line: number; column?: number };
  };
}

interface HeadingInfo {
  text: string;
  depth: number;
  line: number;
  bodyLine: number;
}

interface LineRange {
  start: number;
  end: number;
  startColumn?: number;
  endColumn?: number;
}

export function parseMarkdownDocument(projectRoot: string, absolutePath: string): ParsedDocument {
  assertInsideRoot(projectRoot, absolutePath, "Markdown file path");
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(raw);
  const body = parsed.content;
  const frontmatter = normalizeFrontmatter(parsed.data);
  const frontmatterDiagnostics = parsed.diagnostics;
  const relativePath = relativeUnixPath(projectRoot, absolutePath);
  const id = stableId("document", frontmatter.id ?? relativePath.toLowerCase());
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as MdastNode;
  const bodyLineOffset = parsed.bodyLineOffset;
  const bodyLines = body.split(/\r?\n/);
  const headings = collectHeadings(tree, bodyLineOffset);
  const sections = buildSections(id, headings, bodyLines, bodyLineOffset, frontmatter.title ?? path.basename(relativePath));
  const title = frontmatter.title ?? firstH1(headings) ?? path.basename(relativePath, path.extname(relativePath));
  const codeBlockRanges = collectCodeBlockRanges(tree, bodyLineOffset);
  const inlineCodeRanges = collectInlineCodeRanges(tree, bodyLineOffset);
  const markdownLinks = collectMarkdownLinks(tree, sections, bodyLineOffset);
  const wikiLinks = collectWikiLinks(bodyLines, sections, bodyLineOffset, [...codeBlockRanges, ...inlineCodeRanges]);
  const codeBlocks = collectCodeBlocks(tree, sections, bodyLineOffset);
  const inlineCode = collectInlineCode(tree, sections, bodyLineOffset);

  return {
    id,
    absolutePath,
    relativePath,
    title,
    hash: contentHash(raw),
    frontmatter,
    frontmatterDiagnostics,
    body,
    sections,
    markdownLinks,
    wikiLinks,
    codeBlocks,
    inlineCode
  };
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string; bodyLineOffset: number; diagnostics: ParsedDocument["frontmatterDiagnostics"] } {
  const parsed = parseFrontmatterBlock(raw);
  return { data: parsed.data, content: parsed.body, bodyLineOffset: parsed.bodyLineOffset, diagnostics: parsed.diagnostics };
}

function collectHeadings(tree: MdastNode, bodyLineOffset: number): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  visit(tree, (node) => {
    if (node.type !== "heading" || !node.depth || !node.position) {
      return;
    }
    const bodyLine = node.position.start.line;
    headings.push({
      text: textOf(node),
      depth: node.depth,
      line: bodyLine + bodyLineOffset,
      bodyLine
    });
  });
  return headings.filter((heading) => heading.depth <= 4);
}

function buildSections(
  documentId: string,
  headings: HeadingInfo[],
  bodyLines: string[],
  bodyLineOffset: number,
  fallbackTitle: string
): ParsedSection[] {
  if (!headings.length) {
    const heading = fallbackTitle || "Document";
    return [
      {
        id: stableId("section", `${documentId}:root`),
        anchor: "",
        heading,
        level: 1,
        startLine: bodyLineOffset + 1,
        endLine: bodyLineOffset + bodyLines.length,
        content: bodyLines.join("\n")
      }
    ];
  }

  const slugCounts = new Map<string, number>();
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    const endBodyLine = next ? next.bodyLine - 1 : bodyLines.length;
    const baseSlug = slugifyHeading(heading.text);
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    const anchor = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
    const content = bodyLines.slice(Math.max(heading.bodyLine - 1, 0), Math.max(endBodyLine, heading.bodyLine - 1)).join("\n");
    return {
      id: stableId("section", `${documentId}:${anchor}`),
      anchor,
      heading: heading.text,
      level: heading.depth,
      startLine: heading.line,
      endLine: endBodyLine + bodyLineOffset,
      content
    };
  });
}

function collectMarkdownLinks(tree: MdastNode, sections: ParsedSection[], bodyLineOffset: number): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  visit(tree, (node) => {
    if (node.type !== "link" || !node.url || !node.position) {
      return;
    }
    const line = node.position.start.line + bodyLineOffset;
    links.push({
      text: textOf(node),
      url: node.url,
      title: node.title,
      line,
      sectionId: findSectionId(sections, line)
    });
  });
  return links;
}

function collectWikiLinks(
  bodyLines: string[],
  sections: ParsedSection[],
  bodyLineOffset: number,
  ignoredLineRanges: LineRange[]
): WikiLink[] {
  const wikiLinks: WikiLink[] = [];
  const pattern = /\[\[([^\]]+)\]\]/g;

  bodyLines.forEach((lineText, index) => {
    const line = index + 1 + bodyLineOffset;
    if (isIgnoredLine(line, ignoredLineRanges)) {
      return;
    }
    for (const match of lineText.matchAll(pattern)) {
      const matchStartColumn = (match.index ?? 0) + 1;
      const matchEndColumn = matchStartColumn + match[0].length;
      if (isIgnoredRange(line, matchStartColumn, matchEndColumn, ignoredLineRanges)) {
        continue;
      }
      const parsed = parseWikiLinkTarget(match[1]);
      if (!parsed.target) {
        continue;
      }
      wikiLinks.push({
        raw: match[0],
        target: parsed.target,
        anchor: parsed.anchor,
        alias: parsed.alias,
        line,
        sectionId: findSectionId(sections, line)
      });
    }
  });

  return wikiLinks;
}

function collectInlineCodeRanges(tree: MdastNode, bodyLineOffset: number): LineRange[] {
  const ranges: LineRange[] = [];
  visit(tree, (node) => {
    if (node.type !== "inlineCode" || !node.position) {
      return;
    }
    ranges.push({
      start: node.position.start.line + bodyLineOffset,
      end: node.position.end.line + bodyLineOffset,
      startColumn: node.position.start.column,
      endColumn: node.position.end.column
    });
  });
  return ranges;
}

function collectCodeBlockRanges(tree: MdastNode, bodyLineOffset: number): LineRange[] {
  const ranges: LineRange[] = [];
  visit(tree, (node) => {
    if (node.type !== "code" || !node.position) {
      return;
    }
    ranges.push({
      start: node.position.start.line + bodyLineOffset,
      end: node.position.end.line + bodyLineOffset
    });
  });
  return ranges;
}

function isIgnoredLine(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => range.startColumn === undefined && line >= range.start && line <= range.end);
}

function isIgnoredRange(line: number, startColumn: number, endColumn: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => {
    if (line < range.start || line > range.end) {
      return false;
    }
    if (range.startColumn === undefined || range.endColumn === undefined) {
      return true;
    }
    if (range.start === range.end) {
      return startColumn < range.endColumn && endColumn > range.startColumn;
    }
    if (line === range.start) {
      return endColumn > range.startColumn;
    }
    if (line === range.end) {
      return startColumn < range.endColumn;
    }
    return true;
  });
}

function collectCodeBlocks(tree: MdastNode, sections: ParsedSection[], bodyLineOffset: number): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  visit(tree, (node) => {
    if (node.type !== "code" || typeof node.value !== "string" || !node.position) {
      return;
    }
    const line = node.position.start.line + bodyLineOffset;
    snippets.push({ language: node.lang, value: node.value, line, sectionId: findSectionId(sections, line) });
  });
  return snippets;
}

function collectInlineCode(tree: MdastNode, sections: ParsedSection[], bodyLineOffset: number): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  visit(tree, (node) => {
    if (node.type !== "inlineCode" || typeof node.value !== "string" || !node.position) {
      return;
    }
    const line = node.position.start.line + bodyLineOffset;
    snippets.push({ value: node.value, line, sectionId: findSectionId(sections, line) });
  });
  return snippets;
}

function firstH1(headings: HeadingInfo[]): string | undefined {
  return headings.find((heading) => heading.depth === 1)?.text;
}

function textOf(node: MdastNode): string {
  let text = "";
  let visited = 0;
  const stack: Array<{ node: MdastNode; depth: number }> = [{ node, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    assertTraversalBudget(++visited, current.depth);
    if (typeof current.node.value === "string") {
      text += current.node.value;
    }
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  return text.trim();
}

function findSectionId(sections: ParsedSection[], line: number): string | undefined {
  return sections.find((section) => line >= section.startLine && line <= section.endLine)?.id ?? sections[0]?.id;
}

function visit(node: MdastNode, callback: (node: MdastNode) => void): void {
  let visited = 0;
  const stack: Array<{ node: MdastNode; depth: number }> = [{ node, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    assertTraversalBudget(++visited, current.depth);
    callback(current.node);
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
}

function assertTraversalBudget(nodes: number, depth: number): void {
  if (nodes > PARSER_LIMITS.maxAstNodes) {
    throw new Error(`Markdown AST exceeds node budget (${PARSER_LIMITS.maxAstNodes}).`);
  }
  if (depth > PARSER_LIMITS.maxAstDepth) {
    throw new Error(`Markdown AST exceeds depth budget (${PARSER_LIMITS.maxAstDepth}).`);
  }
}
