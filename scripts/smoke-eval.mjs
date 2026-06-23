import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "dist", "bin", "mdgraph.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-eval-smoke-"));

try {
  assertFile(cliPath, "Run `npm run build` before `npm run smoke:eval`.");
  writeAlphaDocs(root);
  runCli(root, ["index", "--json"]);
  const report = runCliJson(root, ["eval", "--json"]);

  assertEqual(report.querySet, "alpha", "eval should use the alpha query set by default");
  assertEqual(report.summary.cases, 10, "eval should run the alpha evaluation cases");
  assert(Array.isArray(report.cases), "eval should return case results");
  assert(report.cases.every((item) => item.metrics?.budgetFit === true), "eval cases should report context budget fit");
  assert(report.cases.every((item) => typeof item.metrics?.latencyMs === "number"), "eval cases should report latency metrics");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeAlphaDocs(projectRoot) {
  const docsDir = path.join(projectRoot, "docs");
  const adrDir = path.join(docsDir, "adr");
  const apiDir = path.join(docsDir, "api");
  const runbookDir = path.join(docsDir, "runbooks");
  const incidentDir = path.join(docsDir, "incidents");
  const srcAuthDir = path.join(projectRoot, "src", "auth");
  const srcCacheDir = path.join(projectRoot, "src", "cache");
  const srcRoutesDir = path.join(projectRoot, "src", "routes");
  const scriptsDir = path.join(projectRoot, "scripts");

  for (const dir of [adrDir, apiDir, runbookDir, incidentDir, srcAuthDir, srcCacheDir, srcRoutesDir, scriptsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(path.join(srcAuthDir, "AuthService.ts"), "export class AuthService {}\n", "utf8");
  fs.writeFileSync(path.join(srcAuthDir, "AuthServiceV3.ts"), "export class AuthServiceV3 {}\n", "utf8");
  fs.writeFileSync(path.join(srcCacheDir, "redis.ts"), "export class RedisTimeoutError extends Error {}\n", "utf8");
  fs.writeFileSync(path.join(srcRoutesDir, "auth.ts"), "export const loginRoute = '/api/auth/login';\n", "utf8");
  fs.writeFileSync(path.join(scriptsDir, "restart-auth.ps1"), "Write-Output 'restart auth'\n", "utf8");

  writeDoc(path.join(adrDir, "adr-001-cache-failure-policy.md"), [
    "---",
    "id: adr-001-cache-failure-policy",
    "title: Cache Failure Policy ADR",
    "type: adr",
    "defines: [CacheFailurePolicy]",
    "---",
    "# Cache Failure Policy ADR",
    "",
    "## Decision",
    "",
    "`CacheFailurePolicy` requires login to fail closed when cache timeout data is unreliable."
  ]);
  writeDoc(path.join(docsDir, "redis-cache-design.md"), [
    "---",
    "id: redis-cache-design",
    "title: Redis Cache Design",
    "type: design",
    "defines: [RedisTimeoutError]",
    "depends_on: [adr-001-cache-failure-policy]",
    "source_refs: [src/cache/redis.ts]",
    "---",
    "# Redis Cache Design",
    "",
    "## Timeout Handling",
    "",
    "`RedisTimeoutError` follows `CacheFailurePolicy` and returns retry guidance to callers."
  ]);
  writeDoc(path.join(docsDir, "auth-v2-design.md"), [
    "---",
    "id: auth-v2-design",
    "title: Auth v2 Design",
    "type: design",
    "status: superseded",
    "defines: [AuthService]",
    "depends_on: [redis-cache-design, adr-001-cache-failure-policy]",
    "implements: [src/auth/AuthService.ts]",
    "deprecated_by: [auth-v3-design]",
    "---",
    "# Auth v2 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthService` handles `RedisTimeoutError` during login session refresh.",
    "See [login API](api/login-api.md)."
  ]);
  writeDoc(path.join(docsDir, "auth-v3-design.md"), [
    "---",
    "id: auth-v3-design",
    "title: Auth v3 Design",
    "type: design",
    "defines: [AuthServiceV3]",
    "depends_on: [redis-cache-design]",
    "implements: [src/auth/AuthServiceV3.ts]",
    "supersedes: [auth-v2-design]",
    "---",
    "# Auth v3 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthServiceV3` preserves the cache timeout behavior from [[auth-v2-design#session-refresh]]."
  ]);
  writeDoc(path.join(apiDir, "login-api.md"), [
    "---",
    "id: login-api",
    "title: Login API",
    "type: api",
    "defines:",
    "  - GET /api/auth/login",
    "depends_on: [auth-v2-design]",
    "implements: [src/routes/auth.ts]",
    "---",
    "# Login API",
    "",
    "`GET /api/auth/login` calls `AuthService` and surfaces retryable `RedisTimeoutError` responses."
  ]);
  writeDoc(path.join(docsDir, "login-flow.md"), [
    "---",
    "id: login-flow",
    "title: Login Flow",
    "type: spec",
    "defines: [LoginFlow]",
    "depends_on: [login-api]",
    "---",
    "# Login Flow",
    "",
    "`LoginFlow` uses `GET /api/auth/login` and observes `RedisTimeoutError` as a retryable result."
  ]);
  writeDoc(path.join(runbookDir, "auth-retry-runbook.md"), [
    "---",
    "id: auth-retry-runbook",
    "title: Auth Retry Runbook",
    "type: runbook",
    "defines: [AuthRetryRunbook]",
    "depends_on: [redis-cache-design]",
    "source_refs: [scripts/restart-auth.ps1]",
    "---",
    "# Auth Retry Runbook",
    "",
    "Operators use `AuthRetryRunbook` when `RedisTimeoutError` affects `LoginFlow`.",
    "Set `AUTH_RETRY_LIMIT` conservatively before restarting auth workers."
  ]);
  writeDoc(path.join(incidentDir, "redis-timeout-incident.md"), [
    "---",
    "id: redis-timeout-incident",
    "title: Redis Timeout Incident",
    "type: incident",
    "depends_on: [redis-cache-design]",
    "---",
    "# Redis Timeout Incident",
    "",
    "The incident showed `RedisTimeoutError` can slow `LoginFlow` and trigger `AuthRetryRunbook`."
  ]);
}

function writeDoc(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function runCliJson(cwd, args) {
  return JSON.parse(runCli(cwd, args).stdout);
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: node ${cliPath} ${args.join(" ")}`,
      `cwd: ${cwd}`,
      `exit: ${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n"));
  }
  return result;
}

function assertFile(filePath, hint) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} does not exist. ${hint}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}