import fs from "node:fs";
import path from "node:path";
import type { EntityKind, MDGraphConfig } from "../types.js";
import { CONFIG_LIMITS } from "./limits.js";

const defaultEnabledKinds: EntityKind[] = [
  "symbol",
  "api_route",
  "error_code",
  "config_key",
  "file_path",
  "command",
  "package",
  "concept"
];

const MDGRAPH_GITIGNORE_MARKER = "# MDGraph local artifacts";
const MDGRAPH_GITIGNORE_BLOCK = [
  MDGRAPH_GITIGNORE_MARKER,
  ".mdgraph/*",
  "!.mdgraph/config.json"
].join("\n");

export interface InitProjectConfigResult {
  configPath: string;
  configCreated: boolean;
  gitignorePath: string;
  gitignoreUpdated: boolean;
}

export const DEFAULT_CONFIG: MDGraphConfig = {
  docs: {
    include: ["docs/**/*.md", "**/*.md"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.git/**",
      "**/.mdgraph/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.cache/**",
      "temp/**",
      "**/temp/**",
      "tmp/**",
      "**/tmp/**"
    ]
  },
  index: {
    parseMdx: false,
    followGitignore: true,
    maxFileBytes: 524288
  },
  search: {
    defaultLimit: 8,
    maxDepth: 2,
    maxContextChars: 28000,
    highFrequencyEntityThreshold: 50
  },
  entities: {
    enabledKinds: defaultEnabledKinds,
    stopEntities: ["Config", "Error", "Service", "API", "User", "Data"]
  },
  embedding: {
    enabled: false,
    provider: "local-hash",
    model: "mdgraph-local-hash-v1",
    dimensions: 128
  }
};

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, ".mdgraph", "config.json");
}

export function databasePath(projectRoot: string): string {
  return path.join(projectRoot, ".mdgraph", "graph.db");
}

export function loadConfig(projectRoot: string): MDGraphConfig {
  const target = configPath(projectRoot);
  if (!fs.existsSync(target)) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(target, "utf8");
  let parsed: Partial<MDGraphConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<MDGraphConfig>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid MDGraph config at ${target}: ${message}. Fix the JSON syntax or delete the file and run \`mdgraph init\` to regenerate it.`);
  }
  return mergeConfig(DEFAULT_CONFIG, parsed);
}

export function initConfig(projectRoot: string, docsInclude?: string[]): string {
  const target = configPath(projectRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (!fs.existsSync(target)) {
    const config = docsInclude?.length
      ? mergeConfig(DEFAULT_CONFIG, { docs: { ...DEFAULT_CONFIG.docs, include: docsInclude } })
      : DEFAULT_CONFIG;
    fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  return target;
}

export function initProjectConfig(projectRoot: string, docsInclude?: string[]): InitProjectConfigResult {
  const target = configPath(projectRoot);
  const configCreated = !fs.existsSync(target);
  initConfig(projectRoot, docsInclude);
  const gitignore = ensureMdgraphGitignore(projectRoot);

  return {
    configPath: target,
    configCreated,
    gitignorePath: gitignore.path,
    gitignoreUpdated: gitignore.updated
  };
}

function ensureMdgraphGitignore(projectRoot: string): { path: string; updated: boolean } {
  const target = path.join(projectRoot, ".gitignore");
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (hasMdgraphIgnoreProtection(existing)) {
    return { path: target, updated: false };
  }

  const separator = existing.length ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
  fs.writeFileSync(target, `${existing}${separator}${MDGRAPH_GITIGNORE_BLOCK}\n`, "utf8");
  return { path: target, updated: true };
}

function hasMdgraphIgnoreProtection(content: string): boolean {
  if (content.includes(MDGRAPH_GITIGNORE_MARKER)) {
    return true;
  }

  const patterns = new Set(content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => line.replace(/^\//, "")));

  return [".mdgraph/", ".mdgraph/*", ".mdgraph/**", "**/.mdgraph/**"].some((pattern) => patterns.has(pattern));
}

function mergeConfig(base: MDGraphConfig, override: Partial<MDGraphConfig>): MDGraphConfig {
  return {
    docs: {
      include: nonEmptyStringArray(override.docs?.include, base.docs.include),
      exclude: nonEmptyStringArray(override.docs?.exclude, base.docs.exclude)
    },
    index: {
      parseMdx: boolOr(override.index?.parseMdx, base.index.parseMdx),
      followGitignore: boolOr(override.index?.followGitignore, base.index.followGitignore),
      maxFileBytes: boundedPositiveInteger(override.index?.maxFileBytes, base.index.maxFileBytes, "index.maxFileBytes", CONFIG_LIMITS.indexMaxFileBytes)
    },
    search: {
      defaultLimit: boundedPositiveInteger(override.search?.defaultLimit, base.search.defaultLimit, "search.defaultLimit", CONFIG_LIMITS.searchDefaultLimit),
      maxDepth: boundedPositiveInteger(override.search?.maxDepth, base.search.maxDepth, "search.maxDepth", CONFIG_LIMITS.searchMaxDepth),
      maxContextChars: boundedPositiveInteger(override.search?.maxContextChars, base.search.maxContextChars, "search.maxContextChars", CONFIG_LIMITS.searchMaxContextChars),
      highFrequencyEntityThreshold: boundedPositiveInteger(
        override.search?.highFrequencyEntityThreshold,
        base.search.highFrequencyEntityThreshold,
        "search.highFrequencyEntityThreshold",
        CONFIG_LIMITS.searchHighFrequencyEntityThreshold
      )
    },
    entities: {
      enabledKinds: nonEmptyStringArray(override.entities?.enabledKinds, base.entities.enabledKinds) as EntityKind[],
      stopEntities: nonEmptyStringArray(override.entities?.stopEntities, base.entities.stopEntities)
    },
    embedding: {
      enabled: boolOr(override.embedding?.enabled, base.embedding.enabled),
      provider: stringOr(override.embedding?.provider, base.embedding.provider),
      model: stringOr(override.embedding?.model, base.embedding.model),
      dimensions: boundedPositiveInteger(override.embedding?.dimensions, base.embedding.dimensions, "embedding.dimensions", CONFIG_LIMITS.embeddingDimensions)
    }
  };
}

function nonEmptyStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const result = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return result.length ? result : fallback;
}

function boundedPositiveInteger(value: unknown, fallback: number, field: string, max: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new Error(`Invalid MDGraph config: ${field} must be a positive integer at most ${max}.`);
  }
  return value;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
