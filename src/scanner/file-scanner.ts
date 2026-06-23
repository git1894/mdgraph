import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { MDGraphConfig } from "../types.js";

export async function scanMarkdownFiles(projectRoot: string, config: MDGraphConfig): Promise<string[]> {
  const ignore = await resolveIgnorePatterns(projectRoot, config);
  let entries: string[];
  try {
    entries = await fg(config.docs.include, {
      cwd: projectRoot,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: false,
      followSymbolicLinks: false,
      ignore
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to scan Markdown files from ${projectRoot}: ${message}. Check docs.include and docs.exclude globs in ${path.join(projectRoot, ".mdgraph", "config.json")}.`);
  }

  const allowedExtensions = config.index.parseMdx ? [".md", ".mdx"] : [".md"];
  const accepted: string[] = [];

  for (const entry of entries.sort()) {
    if (!allowedExtensions.some((extension) => entry.toLowerCase().endsWith(extension))) {
      continue;
    }
    const stat = await safeStat(entry);
    if (stat && stat.size <= config.index.maxFileBytes) {
      accepted.push(entry);
    }
  }

  return accepted;
}

export async function resolveIgnorePatterns(projectRoot: string, config: MDGraphConfig): Promise<string[]> {
  return config.index.followGitignore
    ? [...config.docs.exclude, ...await readGitignorePatterns(projectRoot)]
    : config.docs.exclude;
}

async function safeStat(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

async function readGitignorePatterns(projectRoot: string): Promise<string[]> {
  const target = path.join(projectRoot, ".gitignore");
  let content: string;
  try {
    content = await fs.readFile(target, "utf8");
  } catch {
    return [];
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .flatMap(toFastGlobIgnorePatterns);
}

function toFastGlobIgnorePatterns(pattern: string): string[] {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\//, "");
  const base = normalized.replace(/\/+$/, "");
  if (!base) {
    return [];
  }

  const directoryPattern = normalized.endsWith("/") ? `${base}/**` : base;
  return base.includes("/")
    ? [directoryPattern]
    : [directoryPattern, `**/${directoryPattern}`];
}
