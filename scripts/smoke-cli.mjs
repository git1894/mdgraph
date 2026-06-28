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
  runInitNoIndexSmoke();
  runBenchmarkSmoke();
  runStrictFailureSmoke();
  runDoctorGateSmoke();
  runDoctorScopeSmoke();
  runExternalEccSmoke();
} finally {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runCleanProjectSmoke() {
  const root = makeTempRoot("mdgraph-cli-smoke-");
  writeCleanDocs(root);

  runCli(root, ["init", "--docs", "docs/**/*.md"]);
  const initStatus = runCliJson(root, ["status", "--json"]);
  assertEqual(initStatus.documents, 3, "init should build the initial graph index");

  const index = runCliJson(root, ["index", "--json"]);
  assertEqual(index.files, 3, "index should include the clean smoke docs");

  const status = runCliJson(root, ["status", "--json"]);
  assertEqual(status.documents, 3, "status should report indexed documents");

  const storageStatus = runCliJson(root, ["status", "--storage", "--json"]);
  assertEqual(storageStatus.counts.documents, 3, "status --storage should include graph counts");
  assert(storageStatus.storage.database.pageSize > 0, "status --storage should include database page size");
  assert(storageStatus.storage.edgeKinds.length > 0, "status --storage should include edge kind distribution");
  assertEqual(storageStatus.storage.vectors.format, "float32_blob", "status --storage should report compact vector storage format");

  const semanticDisabled = runCliJson(root, ["semantic", "status", "--json"]);
  assertEqual(semanticDisabled.state, "disabled", "semantic status should report disabled before semantic indexing");

  const semanticIndex = runCliJson(root, ["index", "--full", "--semantic", "--json"]);
  assertEqual(semanticIndex.counts.vectors, semanticIndex.counts.chunks, "semantic index should build one vector per chunk");

  const semanticStatus = runCliJson(root, ["semantic", "status", "--json"]);
  assertEqual(semanticStatus.state, "ready", "semantic status should report ready when matching vectors exist");
  assertEqual(semanticStatus.vectorStorageFormat, "float32_blob", "semantic status should report Float32 BLOB vector storage");

  const search = runCliJson(root, ["search", "AuthService", "--limit", "3", "--json"]);
  assert(search.some((item) => item.document?.path === "docs/auth-v2-design.md"), "search should find auth design");

  const semanticSearch = runCliJson(root, ["search", "session refresh RedisTimeoutError", "--semantic", "--json"]);
  assert(semanticSearch.some((item) => item.semantic?.provider === "local-hash"), "semantic search JSON should expose provider metadata");

  const searchExplain = runCliJson(root, ["search", "AuthService", "--limit", "3", "--explain", "--json"]);
  assert(searchExplain.ftsQuery.includes("authservice*"), "search --explain should include the FTS query");
  assert(searchExplain.matchedEntities.some((item) => item.name === "AuthService"), "search --explain should include matched entities");
  assertEqual(searchExplain.ranking.fusion, "rrf", "search --explain should report RRF fusion");
  assert(searchExplain.results.every((item) => item.reason.includes("RRF fusion")), "search results should explain RRF ranking");

  const context = runCliJson(root, ["context", "RedisTimeoutError login", "--json"]);
  assert(context.items.some((item) => item.path === "docs/login-flow.md"), "context should include login flow");
  assert(context.items.every((item) => typeof item.nodeId === "string" && item.nodeId.length > 0), "context items should include recovery node ids");
  assert(context.items.every((item) => typeof item.documentId === "string" && item.documentId.length > 0), "context items should include recovery document ids");
  assertEqual(context.debug, undefined, "context should not include debug details by default");

  const contextDebug = runCliJson(root, ["context", "RedisTimeoutError login", "--debug", "--json"]);
  assert(contextDebug.debug.visitedNodes > 0, "context --debug should include visited node count");
  assert(contextDebug.debug.candidateCount >= contextDebug.items.length, "context --debug should include candidate count");
  assertEqual(contextDebug.debug.packingStrategy, "mmr-style-document-round-robin", "context --debug should report MMR-style packing");

  const node = runCliJson(root, ["node", "AuthService", "--json"]);
  assertEqual(node.kind, "entity", "node should resolve AuthService as an entity");

  const trace = runCliJson(root, ["trace", "AuthService", "RedisTimeoutError", "--json"]);
  assertEqual(trace.found, true, "trace should connect AuthService to RedisTimeoutError");

  const graphJson = runCliJson(root, ["export", "graphjson", "--json"]);
  assertEqual(graphJson.format, "mdgraph-graphjson", "export graphjson should report the GraphJSON format");
  assertEqual(graphJson.formatVersion, 1, "export graphjson should report formatVersion 1");
  assertEqual(graphJson.counts.documents, 3, "export graphjson should include repository counts");
  assert(graphJson.nodes.some((node) => node.kind === "source_ref" && node.path === "src/auth/AuthService.ts"), "export graphjson should include source refs");
  assert(graphJson.edges.every((edge) => graphJson.nodes.some((node) => node.id === edge.fromId) && graphJson.nodes.some((node) => node.id === edge.toId)), "export graphjson should exclude dangling chunk endpoint edges");

  const graphJsonPath = path.join(root, "graph.json");
  fs.writeFileSync(graphJsonPath, `${JSON.stringify(graphJson, null, 2)}\n`, "utf8");
  const graphJsonVerify = runCliJson(root, ["import", "graphjson", graphJsonPath, "--verify", "--json"]);
  assertEqual(graphJsonVerify.valid, true, "import graphjson --verify should accept a fresh export");

  const invalidGraphJsonPath = path.join(root, "invalid-graph.json");
  fs.writeFileSync(invalidGraphJsonPath, `${JSON.stringify({ ...graphJson, formatVersion: 999 }, null, 2)}\n`, "utf8");
  const invalidGraphJsonVerify = runCli(root, ["import", "graphjson", invalidGraphJsonPath, "--verify", "--json"], { expectedExitCode: 1 });
  const invalidGraphJson = JSON.parse(invalidGraphJsonVerify.stdout);
  assertEqual(invalidGraphJson.valid, false, "invalid GraphJSON verify should fail");
  assertEqual(invalidGraphJson.errors[0].code, "graphjson.format_version", "invalid GraphJSON verify should expose a stable error code");
  assert(invalidGraphJson.errors[0].remediation.includes("formatVersion 1"), "invalid GraphJSON verify should include remediation");

  const mermaid = runCli(root, ["export", "mermaid", "trace", "AuthService", "RedisTimeoutError"]);
  assert(mermaid.stdout.includes("flowchart LR"), "export mermaid trace should emit Mermaid flowchart text");
  assert(mermaid.stdout.includes("REFERENCES /") || mermaid.stdout.includes("DEFINES /"), "export mermaid trace should include edge kind labels");

  const markdownIndex = runCli(root, ["export", "markdown-index"]);
  assert(markdownIndex.stdout.includes("[[docs/auth-v2-design.md]]"), "export markdown-index should emit Obsidian-style document links");

  const docsSite = runCliJson(root, ["export", "docs-site", "--json"]);
  assertEqual(docsSite.format, "mdgraph-docsite-index", "export docs-site should emit a docs-site index");
  assert(docsSite.documents.some((document) => document.path === "docs/auth-v2-design.md"), "export docs-site should include documents");

  const bridgeUnsupported = runCliJson(root, ["export", "source-bridge", "--json"]);
  assertEqual(bridgeUnsupported.status, "unsupported", "source bridge without artifact should be unsupported");

  const codeGraphArtifact = path.join(root, "codegraph.json");
  fs.writeFileSync(codeGraphArtifact, JSON.stringify({
    files: [{ path: "src/auth/AuthService.ts", symbols: [{ name: "AuthService", kind: "class" }] }]
  }), "utf8");
  const bridge = runCliJson(root, ["export", "source-bridge", "--json", "--artifact", codeGraphArtifact]);
  assertEqual(bridge.status, "ready", "source bridge should read a fixture CodeGraph artifact");
  assertEqual(bridge.matched.length, 1, "source bridge should match one source ref");

  const doctor = runCliJson(root, ["doctor", "--json"]);
  assertEqual(totalDoctorIssues(doctor.summary), 0, "clean smoke docs should have no doctor issues");
  runCli(root, ["doctor", "--strict"]);

  const bundle = runCliJson(root, ["bundle", "create", "--profile", "private", "--json"]);
  assertEqual(bundle.manifest.visibility, "private", "bundle create should use private visibility");
  assertFile(path.join(bundle.bundleDir, "manifest.json"), "bundle create should write manifest.json.");
  assertFile(path.join(bundle.bundleDir, "graph.db"), "bundle create should write graph.db.");
  assertFile(path.join(bundle.bundleDir, "config.json"), "bundle create should write config.json.");

  const bundleVerify = runCliJson(root, ["bundle", "verify", bundle.bundleDir, "--json"]);
  assertEqual(bundleVerify.valid, true, "bundle verify should accept the freshly created bundle");
  assertEqual(bundleVerify.freshness.state, "fresh", "bundle verify should compare source hash against the current workspace");

  const report = runCliJson(root, ["report", "--json", "--eval", "--bundle", bundle.bundleDir]);
  assertEqual(report.indexed, true, "report should detect the indexed smoke project");
  assertEqual(report.schema.schemaVersion, 1, "report should include schema metadata");
  assertEqual(report.schema.baseline, "current", "report should mark a freshly created database as current");
  assertEqual(report.bundle.valid, true, "report should include bundle verification");
  assert(report.eval.summary.cases > 0, "report --eval should include evaluation summary");
}

function runInitNoIndexSmoke() {
  const root = makeTempRoot("mdgraph-cli-init-no-index-");
  writeCleanDocs(root);

  runCli(root, ["init", "--docs", "docs/**/*.md", "--no-index"]);
  const status = runCliJson(root, ["status", "--json"]);
  assertEqual(status.indexed, false, "init --no-index should leave the graph inactive");
}

function runBenchmarkSmoke() {
  const root = makeTempRoot("mdgraph-cli-benchmark-");
  const benchmarkCases = [
    {
      id: "alpha-1",
      question: "Why does RedisTimeoutError affect LoginFlow?",
      searchQuery: "RedisTimeoutError LoginFlow",
      expectedPaths: ["docs/redis-cache-design.md", "docs/login-flow.md", "docs/runbooks/auth-retry-runbook.md"]
    },
    {
      id: "alpha-2",
      question: "Which runbook covers auth retry when Redis timeout affects login?",
      searchQuery: "AuthRetryRunbook RedisTimeoutError LoginFlow",
      expectedPaths: ["docs/runbooks/auth-retry-runbook.md", "docs/login-flow.md", "docs/redis-cache-design.md"]
    },
    {
      id: "alpha-3",
      question: "Which cache design documents retry guidance for login failures?",
      searchQuery: "cache retry LoginFlow RedisTimeoutError",
      expectedPaths: ["docs/redis-cache-design.md", "docs/login-flow.md", "docs/runbooks/auth-retry-runbook.md"]
    }
  ];
  writeBenchmarkDocs(root);
  runCli(root, ["init", "--docs", "docs/**/*.md"]);
  runCli(root, ["index", "--json"]);

  const runs = benchmarkCases.flatMap((benchmarkCase) => benchmarkRunPair(root, benchmarkCase));
  const benchmarkPath = path.join(root, "benchmark-runs.json");
  fs.writeFileSync(benchmarkPath, `${JSON.stringify({ runs }, null, 2)}\n`, "utf8");

  const benchmarkReport = runCliJson(root, ["report", "--json", "--benchmark", benchmarkPath]);
  assertEqual(benchmarkReport.benchmark.summary.completePairs, 3, "report --benchmark should include three complete paired benchmarks");
  assertEqual(benchmarkReport.benchmark.summary.aggregateDelta.directFileReads, -9, "benchmark aggregate should report file-read delta");
  assertEqual(benchmarkReport.benchmark.summary.aggregateDelta.mdgraphCalls, 3, "benchmark aggregate should report MDGraph call delta");
}

function benchmarkRunPair(root, benchmarkCase) {
  const withStartedAt = new Date().toISOString();
  const withStart = Date.now();
  const contextResult = runCli(root, ["context", benchmarkCase.question, "--json"]);
  const withLatencyMs = Date.now() - withStart;
  const context = JSON.parse(contextResult.stdout);
  const contextPaths = unique(context.items.map((item) => item.path)).filter((item) => benchmarkCase.expectedPaths.includes(item));

  const withoutStartedAt = new Date().toISOString();
  const withoutStart = Date.now();
  const textSearch = searchMarkdown(root, benchmarkCase.searchQuery);
  const directFileReads = benchmarkCase.expectedPaths.map((relativePath) => ({
    path: relativePath,
    chars: fs.readFileSync(path.join(root, relativePath), "utf8").length
  }));
  const withoutLatencyMs = Date.now() - withoutStart;

  return [
    {
      id: `smoke-with-mdgraph-${benchmarkCase.id}`,
      questionId: benchmarkCase.id,
      question: benchmarkCase.question,
      mode: "with_mdgraph",
      startedAt: withStartedAt,
      completedAt: new Date().toISOString(),
      toolCalls: [{ name: "mdgraph_context", outputChars: contextResult.stdout.length }],
      directFileReads: [],
      textSearches: [],
      mdgraphCalls: [{ tool: "mdgraph_context", query: benchmarkCase.question, resultCount: context.items.length, chars: context.usedChars }],
      finalCitations: contextPaths.map((documentPath) => ({ path: documentPath })),
      rawFileFallback: false,
      characterBudget: context.usedChars,
      latencyMs: withLatencyMs
    },
    {
      id: `smoke-without-mdgraph-${benchmarkCase.id}`,
      questionId: benchmarkCase.id,
      question: benchmarkCase.question,
      mode: "without_mdgraph",
      startedAt: withoutStartedAt,
      completedAt: new Date().toISOString(),
      toolCalls: [
        { name: "text_search", outputChars: textSearch.outputChars },
        ...directFileReads.map((read) => ({ name: "read_file", outputChars: read.chars }))
      ],
      directFileReads,
      textSearches: [{ query: benchmarkCase.searchQuery, resultCount: textSearch.resultCount }],
      mdgraphCalls: [],
      finalCitations: benchmarkCase.expectedPaths.map((documentPath) => ({ path: documentPath })),
      rawFileFallback: true,
      characterBudget: textSearch.outputChars + directFileReads.reduce((total, read) => total + read.chars, 0),
      latencyMs: withoutLatencyMs
    }
  ];
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

function runDoctorGateSmoke() {
  const root = makeTempRoot("mdgraph-cli-fail-on-");
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "weak.md"), "# Weak\n", "utf8");

  runCli(root, ["index", "--json"]);
  runCli(root, ["doctor", "--fail-on", "error"]);
  runCli(root, ["doctor", "--fail-on", "info"], { expectedExitCode: 1 });
}

function runDoctorScopeSmoke() {
  const root = makeTempRoot("mdgraph-cli-scope-");
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "stable.md"), "# Stable\n", "utf8");
  fs.writeFileSync(path.join(docsDir, "changed.md"), "# Changed\n\nSee [Stable](./stable.md).\n", "utf8");
  fs.writeFileSync(path.join(docsDir, "deleted.md"), "# Deleted\n", "utf8");
  fs.writeFileSync(path.join(docsDir, "rename-source.md"), "# Rename Source\n", "utf8");

  runCli(root, ["index", "--json"]);
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "mdgraph@example.test"]);
  runGit(root, ["config", "user.name", "MDGraph Smoke"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "initial"]);

  fs.appendFileSync(path.join(docsDir, "changed.md"), "\nSee [missing](./missing.md).\n", "utf8");
  fs.rmSync(path.join(docsDir, "deleted.md"));
  runGit(root, ["mv", "docs/rename-source.md", "docs/renamed.md"]);
  fs.writeFileSync(path.join(docsDir, "new.md"), "# New\n", "utf8");
  const changed = runCliJson(root, ["doctor", "--changed", "--json"]);
  assertEqual(changed.scope.mode, "changed", "doctor --changed should report changed scope");
  assert(changed.scope.changedPaths.includes("docs/changed.md"), "doctor --changed should include modified markdown");
  assert(changed.scope.deletedPaths.includes("docs/deleted.md"), "doctor --changed should include deleted markdown");
  assert(changed.scope.renamedPaths.some((item) => item.from === "docs/rename-source.md" && item.to === "docs/renamed.md"), "doctor --changed should include renamed markdown");
  assert(changed.scope.untrackedPaths.includes("docs/new.md"), "doctor --changed should include untracked markdown");
  assert(changed.warnings.every((warning) => warning.code === "index.stale"), "stale scoped report should only include freshness warnings");

  runCli(root, ["index", "--json"]);
  const diff = runCliJson(root, ["diff", "--base", "HEAD", "--json"]);
  assertEqual(diff.mode, "base_ref", "diff --base should report base_ref mode");
  assert(diff.summary.documentsModified >= 1, "diff --base should include modified Markdown");
  assert(diff.summary.documentsDeleted >= 1, "diff --base should include deleted Markdown");
  assert(diff.summary.documentsRenamed >= 1, "diff --base should include renamed Markdown");
  assert(diff.impact.prSummary.length > 0, "diff --base should include PR summary lines");

  const reportWithDiff = runCliJson(root, ["report", "--json", "--base", "HEAD"]);
  assert(reportWithDiff.diff?.summary.documentsModified >= 1, "report --base should include diff summary");

  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "changed docs"]);
  const since = runCliJson(root, ["doctor", "--since", "HEAD~1", "--json"]);
  assertEqual(since.scope.mode, "since", "doctor --since should report since scope");
  assertEqual(since.scope.baseRef, "HEAD~1", "doctor --since should preserve base ref");
  assert(since.scope.changedPaths.includes("docs/changed.md"), "doctor --since should include modified markdown");
  assert(since.scope.deletedPaths.includes("docs/deleted.md"), "doctor --since should include deleted markdown");
  assert(since.scope.renamedPaths.some((item) => item.from === "docs/rename-source.md" && item.to === "docs/renamed.md"), "doctor --since should include renamed markdown");
  assert(since.warnings.some((warning) => warning.code === "document.deleted"), "doctor --since should warn about deleted markdown after reindex");
  assert(since.health.graph.mostConnectedDocs.some((item) => item.path === "docs/stable.md"), "doctor --since should include directly related unchanged markdown");

  runCli(root, ["doctor", "--since", "missing-ref"], { expectedExitCode: 1 });

  const noGitRoot = makeTempRoot("mdgraph-cli-scope-no-git-");
  fs.mkdirSync(path.join(noGitRoot, "docs"), { recursive: true });
  fs.writeFileSync(path.join(noGitRoot, "docs", "note.md"), "# Note\n", "utf8");
  runCli(noGitRoot, ["doctor", "--changed"], { expectedExitCode: 1 });
}

function runExternalEccSmoke() {
  const configuredPath = process.env.MDGRAPH_EXTERNAL_ECC_PATH;
  if (!configuredPath) {
    console.log("External ECC smoke skipped: MDGRAPH_EXTERNAL_ECC_PATH is not set.");
    return;
  }
  const root = path.resolve(configuredPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.log(`External ECC smoke skipped: MDGRAPH_EXTERNAL_ECC_PATH is not a directory (${root}).`);
    return;
  }
  runCli(root, ["index", "--json"]);
  runCli(root, ["doctor", "--json"]);
  const evalReport = runCliJson(root, ["eval", "--query-set", "ecc", "--path", root, "--json"]);
  assertEqual(evalReport.querySet, "ecc", "external ECC eval should use the ECC query set when enabled");
  assert(evalReport.cases.length > 0, "external ECC eval should include path-only cases when enabled");
  const bundle = runCliJson(root, ["bundle", "create", "--profile", "private", "--json"]);
  const verified = runCliJson(root, ["bundle", "verify", bundle.bundleDir, "--json"]);
  assertEqual(verified.valid, true, "external ECC bundle should verify when MDGRAPH_EXTERNAL_ECC_PATH is enabled");
  const report = runCliJson(root, ["report", "--json", "--bundle", bundle.bundleDir]);
  assertEqual(report.bundle.valid, true, "external ECC report should include valid bundle verification");
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

function writeBenchmarkDocs(root) {
  const docsDir = path.join(root, "docs");
  const runbooksDir = path.join(docsDir, "runbooks");
  fs.mkdirSync(runbooksDir, { recursive: true });

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
    "## Timeout Handling",
    "",
    "`RedisTimeoutError` follows cache failure policy and returns retry guidance.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "login-flow.md"), [
    "---",
    "id: login-flow",
    "title: Login Flow",
    "type: spec",
    "defines:",
    "  - LoginFlow",
    "depends_on:",
    "  - redis-cache-design",
    "---",
    "# Login Flow",
    "",
    "`LoginFlow` handles `RedisTimeoutError` as a retryable result.",
    "See [Redis Cache Design](./redis-cache-design.md).",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(runbooksDir, "auth-retry-runbook.md"), [
    "---",
    "id: auth-retry-runbook",
    "title: Auth Retry Runbook",
    "type: runbook",
    "defines:",
    "  - AuthRetryRunbook",
    "depends_on:",
    "  - login-flow",
    "---",
    "# Auth Retry Runbook",
    "",
    "Use this runbook when `RedisTimeoutError` affects `LoginFlow`.",
    ""
  ].join("\n"), "utf8");
}

function searchMarkdown(root, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let outputChars = 0;
  let resultCount = 0;
  for (const filePath of markdownFiles(path.join(root, "docs"))) {
    const content = fs.readFileSync(filePath, "utf8");
    const lower = content.toLowerCase();
    if (terms.some((term) => lower.includes(term))) {
      resultCount += 1;
      outputChars += content.length;
    }
  }
  return { resultCount, outputChars };
}

function markdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(entryPath));
    } else if (/\.mdx?$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function unique(values) {
  return [...new Set(values)];
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

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error([
      `Git command failed: git ${args.join(" ")}`,
      `cwd: ${cwd}`,
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
