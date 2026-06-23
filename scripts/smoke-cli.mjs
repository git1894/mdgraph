import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "dist", "bin", "mdgraph.js");
const tempRoots = [];

try {
  assertFile(cliPath, "Run `npm run build` before `npm run smoke:cli`.");
  runCleanProjectSmoke();
  runStrictFailureSmoke();
} finally {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runCleanProjectSmoke() {
  const root = makeTempRoot("mdgraph-cli-smoke-");
  writeCleanDocs(root);

  runCli(root, ["init", "--docs", "docs/**/*.md"]);
  const index = runCliJson(root, ["index", "--json"]);
  assertEqual(index.files, 3, "index should include the clean smoke docs");

  const status = runCliJson(root, ["status", "--json"]);
  assertEqual(status.documents, 3, "status should report indexed documents");

  const storageStatus = runCliJson(root, ["status", "--storage", "--json"]);
  assertEqual(storageStatus.counts.documents, 3, "status --storage should include graph counts");
  assert(storageStatus.storage.database.pageSize > 0, "status --storage should include database page size");
  assert(storageStatus.storage.edgeKinds.length > 0, "status --storage should include edge kind distribution");

  const search = runCliJson(root, ["search", "AuthService", "--limit", "3", "--json"]);
  assert(search.some((item) => item.document?.path === "docs/auth-v2-design.md"), "search should find auth design");

  const searchExplain = runCliJson(root, ["search", "AuthService", "--limit", "3", "--explain", "--json"]);
  assert(searchExplain.ftsQuery.includes("authservice*"), "search --explain should include the FTS query");
  assert(searchExplain.matchedEntities.some((item) => item.name === "AuthService"), "search --explain should include matched entities");

  const context = runCliJson(root, ["context", "RedisTimeoutError login", "--json"]);
  assert(context.items.some((item) => item.path === "docs/login-flow.md"), "context should include login flow");
  assertEqual(context.debug, undefined, "context should not include debug details by default");

  const contextDebug = runCliJson(root, ["context", "RedisTimeoutError login", "--debug", "--json"]);
  assert(contextDebug.debug.visitedNodes > 0, "context --debug should include visited node count");
  assert(contextDebug.debug.candidateCount >= contextDebug.items.length, "context --debug should include candidate count");

  const node = runCliJson(root, ["node", "AuthService", "--json"]);
  assertEqual(node.kind, "entity", "node should resolve AuthService as an entity");

  const trace = runCliJson(root, ["trace", "AuthService", "RedisTimeoutError", "--json"]);
  assertEqual(trace.found, true, "trace should connect AuthService to RedisTimeoutError");

  const doctor = runCliJson(root, ["doctor", "--json"]);
  assertEqual(totalDoctorIssues(doctor.summary), 0, "clean smoke docs should have no doctor issues");
  runCli(root, ["doctor", "--strict"]);
}

function runStrictFailureSmoke() {
  const root = makeTempRoot("mdgraph-cli-strict-");
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "broken.md"), [
    "---",
    "title: Broken Design",
    "type: design",
    "source_refs:",
    "  - src/missing.ts",
    "---",
    "# Broken Design",
    "",
    "See [missing](./missing.md).",
    ""
  ].join("\n"), "utf8");

  runCli(root, ["index", "--json"]);
  const result = runCli(root, ["doctor", "--strict"], { expectedExitCode: 1 });
  assert(result.stdout.includes("Dead links") || result.stdout.includes("deadLinks"), "strict doctor output should include health details");
}

function writeCleanDocs(root) {
  const docsDir = path.join(root, "docs");
  const srcDir = path.join(root, "src", "auth");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "AuthService.ts"), "export class AuthService {}\n", "utf8");

  fs.writeFileSync(path.join(docsDir, "redis-cache-design.md"), [
    "---",
    "id: redis-cache-design",
    "title: Redis Cache Design",
    "type: design",
    "defines:",
    "  - RedisTimeoutError",
    "---",
    "# Redis Cache Design",
    "",
    "## Defines",
    "",
    "- `RedisTimeoutError`: Redis timeout surfaced to callers.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "auth-v2-design.md"), [
    "---",
    "id: auth-v2-design",
    "title: Auth v2 Design",
    "type: design",
    "defines:",
    "  - AuthService",
    "depends_on:",
    "  - redis-cache-design",
    "implements:",
    "  - src/auth/AuthService.ts",
    "---",
    "# Auth v2 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthService` handles `RedisTimeoutError` during session refresh.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "login-flow.md"), [
    "---",
    "id: login-flow",
    "title: Login Flow",
    "type: spec",
    "defines:",
    "  - LoginFlow",
    "---",
    "# Login Flow",
    "",
    "The login flow uses `AuthService` and handles `RedisTimeoutError`.",
    "See [[auth-v2-design#session-refresh]].",
    ""
  ].join("\n"), "utf8");
}

function makeTempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function runCliJson(cwd, args) {
  return JSON.parse(runCli(cwd, args).stdout);
}

function runCli(cwd, args, options = {}) {
  const expectedExitCode = options.expectedExitCode ?? 0;
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== expectedExitCode) {
    throw new Error([
      `Command failed: node ${cliPath} ${args.join(" ")}`,
      `cwd: ${cwd}`,
      `expected exit: ${expectedExitCode}`,
      `actual exit: ${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n"));
  }
  return result;
}

function totalDoctorIssues(summary) {
  return Object.entries(summary)
    .filter(([key]) => key !== "documents")
    .reduce((total, [, value]) => total + Number(value), 0);
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