import { spawnSync } from "node:child_process";
import type { DoctorScope, DoctorScopeRename } from "./doctor.js";
import { normalizePath } from "../utils/text.js";

export type DoctorScopeRequest =
  | { mode: "changed" }
  | { mode: "since"; baseRef: string };

interface ParsedNameStatus {
  changedPaths: string[];
  deletedPaths: string[];
  renamedPaths: DoctorScopeRename[];
}

export function collectDoctorScope(projectRoot: string, request: DoctorScopeRequest): DoctorScope {
  ensureGitWorktree(projectRoot);
  ensureGitHead(projectRoot);

  if (request.mode === "changed") {
    const unstaged = parseNameStatus(runGit(projectRoot, ["diff", "--name-status", "-M", "--", "."]));
    const staged = parseNameStatus(runGit(projectRoot, ["diff", "--cached", "--name-status", "-M", "--", "."]));
    const untrackedPaths = runGit(projectRoot, ["ls-files", "--others", "--exclude-standard"])
      .split(/\r?\n/)
      .map(markdownPath)
      .filter((value): value is string => Boolean(value));
    return scopeFromParts("changed", undefined, mergeNameStatus(unstaged, staged), untrackedPaths);
  }

  const baseRef = validateBaseRef(request.baseRef);
  const diff = parseNameStatus(runGit(projectRoot, ["diff", "--name-status", "-M", "--end-of-options", `${baseRef}...HEAD`, "--", "."]));
  return scopeFromParts("since", baseRef, diff, []);
}

function scopeFromParts(mode: DoctorScope["mode"], baseRef: string | undefined, parsed: ParsedNameStatus, untrackedPaths: string[]): DoctorScope {
  return {
    mode,
    baseRef,
    changedPaths: uniqueSorted(parsed.changedPaths),
    deletedPaths: uniqueSorted(parsed.deletedPaths),
    renamedPaths: uniqueRenames(parsed.renamedPaths),
    untrackedPaths: uniqueSorted(untrackedPaths),
    globalHealthIncluded: false
  };
}

function mergeNameStatus(left: ParsedNameStatus, right: ParsedNameStatus): ParsedNameStatus {
  return {
    changedPaths: [...left.changedPaths, ...right.changedPaths],
    deletedPaths: [...left.deletedPaths, ...right.deletedPaths],
    renamedPaths: [...left.renamedPaths, ...right.renamedPaths]
  };
}

function parseNameStatus(output: string): ParsedNameStatus {
  const result: ParsedNameStatus = { changedPaths: [], deletedPaths: [], renamedPaths: [] };
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [status, firstPath, secondPath] = line.split("\t");
    if (!status || !firstPath) {
      continue;
    }
    if (status.startsWith("R") && secondPath) {
      const from = markdownPath(firstPath);
      const to = markdownPath(secondPath);
      if (from || to) {
        result.renamedPaths.push({ from: from ?? normalizePath(firstPath), to: to ?? normalizePath(secondPath) });
        if (to) {
          result.changedPaths.push(to);
        }
      }
      continue;
    }
    const normalized = markdownPath(firstPath);
    if (!normalized) {
      continue;
    }
    if (status.startsWith("D")) {
      result.deletedPaths.push(normalized);
    } else {
      result.changedPaths.push(normalized);
    }
  }
  return result;
}

function markdownPath(value: string): string | undefined {
  const normalized = normalizePath(value).replace(/^\.\//, "");
  return /\.mdx?$/i.test(normalized) ? normalized : undefined;
}

function ensureGitWorktree(projectRoot: string): void {
  const output = runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"]).trim();
  if (output !== "true") {
    throw new Error("doctor scoped checks require a Git worktree.");
  }
}

function ensureGitHead(projectRoot: string): void {
  runGit(projectRoot, ["rev-parse", "--verify", "HEAD"]);
}

function validateBaseRef(baseRef: string): string {
  const trimmed = baseRef.trim();
  if (!trimmed || trimmed.startsWith("-") || /[\s\0]/u.test(trimmed)) {
    throw new Error("doctor --since requires a non-option Git ref without whitespace.");
  }
  return trimmed;
}

function runGit(projectRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error([
      `Git command failed: git ${args.join(" ")}`,
      result.stderr.trim() || result.stdout.trim() || "No Git error output."
    ].join("\n"));
  }
  return result.stdout;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizePath))].sort();
}

function uniqueRenames(values: DoctorScopeRename[]): DoctorScopeRename[] {
  return [...new Map(values.map((value) => [`${normalizePath(value.from)}\0${normalizePath(value.to)}`, {
    from: normalizePath(value.from),
    to: normalizePath(value.to)
  }])).values()].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}
