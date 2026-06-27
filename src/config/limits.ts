export const CONFIG_LIMITS = {
  indexMaxFileBytes: 10 * 1024 * 1024,
  searchDefaultLimit: 100,
  searchMaxDepth: 12,
  searchMaxContextChars: 200_000,
  searchHighFrequencyEntityThreshold: 100_000,
  embeddingDimensions: 4096
} as const;

export const MCP_LIMITS = {
  searchLimit: CONFIG_LIMITS.searchDefaultLimit,
  traceDepth: CONFIG_LIMITS.searchMaxDepth,
  contextMaxChars: CONFIG_LIMITS.searchMaxContextChars,
  jsonRpcLineBytes: 1024 * 1024
} as const;

export const PARSER_LIMITS = {
  maxAstNodes: 10_000,
  maxAstDepth: 256
} as const;

export const JSON_ARTIFACT_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxArrayLength: 1_000_000
} as const;
