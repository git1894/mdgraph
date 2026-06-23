import fs from "node:fs";
import path from "node:path";
import type { EntityKind, MDGraphConfig } from "../types.js";

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

function mergeConfig(base: MDGraphConfig, override: Partial<MDGraphConfig>): MDGraphConfig {
  return {
    docs: {
      include: nonEmptyStringArray(override.docs?.include, base.docs.include),
      exclude: nonEmptyStringArray(override.docs?.exclude, base.docs.exclude)
    },
    index: {
      parseMdx: boolOr(override.index?.parseMdx, base.index.parseMdx),
      followGitignore: boolOr(override.index?.followGitignore, base.index.followGitignore),
      maxFileBytes: positiveNumberOr(override.index?.maxFileBytes, base.index.maxFileBytes)
    },
    search: {
      defaultLimit: positiveNumberOr(override.search?.defaultLimit, base.search.defaultLimit),
      maxDepth: positiveNumberOr(override.search?.maxDepth, base.search.maxDepth),
      maxContextChars: positiveNumberOr(override.search?.maxContextChars, base.search.maxContextChars),
      highFrequencyEntityThreshold: positiveNumberOr(
        override.search?.highFrequencyEntityThreshold,
        base.search.highFrequencyEntityThreshold
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
      dimensions: positiveNumberOr(override.embedding?.dimensions, base.embedding.dimensions)
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

function positiveNumberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
