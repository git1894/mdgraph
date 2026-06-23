export interface ParsedWikiLinkTarget {
  target: string;
  anchor?: string;
  alias?: string;
}

export function parseWikiLinkTarget(value: string): ParsedWikiLinkTarget {
  const [targetAndAnchor, alias] = value.split("|").map((part) => part.trim());
  const [target, anchor] = targetAndAnchor.split("#").map((part) => part.trim());
  return {
    target,
    anchor: anchor || undefined,
    alias: alias || undefined
  };
}