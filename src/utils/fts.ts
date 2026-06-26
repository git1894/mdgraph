const cjkRunPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

export function ftsIndexContent(content: string): string {
  const cjkTokens = cjkNgramTokens(content);
  return cjkTokens.length ? `${content}\n${cjkTokens.join(" ")}` : content;
}

export function ftsQueryFor(query: string): string {
  const tokens = ftsQueryTokens(query).slice(0, 24);
  return [...new Set(tokens)].map((token) => `${escapeFtsToken(token)}*`).join(" OR ");
}

export function ftsQueryTokens(query: string): string[] {
  const tokens: string[] = [];
  const lexicalTokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];

  for (const token of lexicalTokens) {
    const cjkTokens = cjkNgramTokens(token);
    tokens.push(...cjkTokens);

    const nonCjkText = token.replace(cjkRunPattern, " ");
    tokens.push(...nonCjkText
      .match(/[\p{L}\p{N}_]+/gu)
      ?.flatMap((part) => part.split("_")) ?? []);

    if (!cjkTokens.length) {
      tokens.push(...token.split("_"));
    }
  }

  return tokens
    .map(escapeFtsToken)
    .filter((token) => token.length > 1)
    .filter((token) => !isFtsOperatorToken(token));
}

function cjkNgramTokens(content: string): string[] {
  const tokens: string[] = [];
  for (const match of content.matchAll(cjkRunPattern)) {
    tokens.push(...ngrams(Array.from(match[0]), 2));
    tokens.push(...ngrams(Array.from(match[0]), 3));
  }
  return tokens;
}

function ngrams(chars: string[], size: number): string[] {
  if (chars.length < size) {
    return [];
  }
  const result: string[] = [];
  for (let index = 0; index <= chars.length - size; index += 1) {
    result.push(chars.slice(index, index + size).join(""));
  }
  return result;
}

function isFtsOperatorToken(token: string): boolean {
  return token === "and" || token === "or" || token === "not" || token === "near";
}

function escapeFtsToken(token: string): string {
  return token.replace(/[^\p{L}\p{N}_]/gu, "");
}
