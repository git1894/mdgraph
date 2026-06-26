import type { MDGraphConfig } from "../types.js";
import { ftsQueryTokens } from "../utils/fts.js";

export const LOCAL_EMBEDDING_PROVIDER = "local-hash";

export function supportsLocalEmbedding(config: MDGraphConfig): boolean {
  return config.embedding.enabled && config.embedding.provider === LOCAL_EMBEDDING_PROVIDER;
}

export function embedTextLocal(content: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = ftsQueryTokens(content);

  for (const token of tokens) {
    const index = positiveHash(token) % dimensions;
    const sign = positiveHash(`sign:${token}`) % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(token.length));
  }

  return normalizeVector(vector);
}

function positiveHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}
