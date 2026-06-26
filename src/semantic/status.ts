import type { StorageDiagnostics, StatusCounts } from "../db/repositories.js";
import type { MDGraphConfig } from "../types.js";
import { LOCAL_EMBEDDING_PROVIDER } from "./local-embedding.js";

export type SemanticStatusState = "disabled" | "not_indexed" | "ready" | "unsupported_provider" | "needs_reindex";

export interface SemanticStatusReport {
  state: SemanticStatusState;
  enabled: boolean;
  provider: string;
  model: string;
  dimensions: number;
  providerSupported: boolean;
  indexed: boolean;
  chunks: number;
  vectors: number;
  vectorStorageFormat: StorageDiagnostics["vectors"]["format"];
  indexedProviders: StorageDiagnostics["vectors"]["providers"];
  guidance: string[];
}

export const SUPPORTED_EMBEDDING_PROVIDERS = [LOCAL_EMBEDDING_PROVIDER] as const;

export function semanticStatusReport(
  config: MDGraphConfig,
  counts: StatusCounts | undefined,
  storage: StorageDiagnostics | undefined
): SemanticStatusReport {
  const providerSupported = isSupportedEmbeddingProvider(config.embedding.provider);
  const indexed = Boolean(counts);
  const chunks = counts?.chunks ?? 0;
  const vectors = counts?.vectors ?? 0;
  const indexedProviders = storage?.vectors.providers ?? [];
  const vectorStorageFormat = storage?.vectors.format ?? "unknown";
  const matchingProvider = indexedProviders.find((provider) => (
    provider.provider === config.embedding.provider
    && provider.model === config.embedding.model
    && provider.dimensions === config.embedding.dimensions
  ));

  const guidance: string[] = [];
  if (!config.embedding.enabled) {
    guidance.push("Semantic search is disabled by default; pass `search --semantic` or set embedding.enabled=true to use indexed vectors automatically.");
  }
  if (!indexed) {
    guidance.push("No index is available; run `mdgraph index` before checking semantic coverage.");
  }
  if (!providerSupported) {
    guidance.push(`Provider '${config.embedding.provider}' is not available in this build; semantic search degrades to FTS5 and graph search.`);
  }
  if (config.embedding.enabled && indexed && providerSupported && !matchingProvider) {
    guidance.push("Run `mdgraph index --semantic` to build vectors for the configured provider/model/dimensions.");
  }
  if (config.embedding.enabled && indexed && vectors > 0 && vectors !== chunks) {
    guidance.push("Vector count does not match chunk count; run `mdgraph index --full --semantic` to re-embed current chunks.");
  }
  if (indexed && vectorStorageFormat === "legacy_json") {
    guidance.push("Vector storage uses legacy JSON arrays; reopen the index with this version or run `mdgraph index --full --semantic` to migrate to Float32 BLOB storage.");
  }
  if (indexed && vectorStorageFormat === "float32_blob") {
    guidance.push("Vector storage uses compact Float32 BLOB rows.");
  }

  return {
    state: semanticState({ config, indexed, providerSupported, matchingProvider: Boolean(matchingProvider), chunks, vectors }),
    enabled: config.embedding.enabled,
    provider: config.embedding.provider,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
    providerSupported,
    indexed,
    chunks,
    vectors,
    vectorStorageFormat,
    indexedProviders,
    guidance
  };
}

function isSupportedEmbeddingProvider(provider: string): boolean {
  return SUPPORTED_EMBEDDING_PROVIDERS.includes(provider as typeof SUPPORTED_EMBEDDING_PROVIDERS[number]);
}

function semanticState(input: {
  config: MDGraphConfig;
  indexed: boolean;
  providerSupported: boolean;
  matchingProvider: boolean;
  chunks: number;
  vectors: number;
}): SemanticStatusState {
  if (!input.indexed) {
    return input.config.embedding.enabled ? "not_indexed" : "disabled";
  }
  if (!input.providerSupported) {
    return "unsupported_provider";
  }
  if (input.matchingProvider && input.vectors === input.chunks) {
    return "ready";
  }
  if (!input.config.embedding.enabled) {
    return "disabled";
  }
  if (!input.matchingProvider || input.vectors !== input.chunks) {
    return "needs_reindex";
  }
  return "ready";
}
