import path from "node:path";
import { normalizePath } from "./text.js";

export function isPathInsideOrEqual(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveInsideRoot(root: string, target: string): string | undefined {
  const resolved = path.resolve(root, target);
  return isPathInsideOrEqual(root, resolved) ? resolved : undefined;
}

export function assertInsideRoot(root: string, target: string, label = "path"): string {
  const resolved = path.resolve(target);
  if (!isPathInsideOrEqual(root, resolved)) {
    throw new Error(`${label} must stay inside project root: ${target}`);
  }
  return resolved;
}

export function relativePathInsideRoot(root: string, target: string): string | undefined {
  if (!isPathInsideOrEqual(root, target)) {
    return undefined;
  }
  return normalizePath(path.relative(path.resolve(root), path.resolve(target)));
}
