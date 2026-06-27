import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const tempRoots = [];

try {
  const packDir = makeTempRoot("mdgraph-pack-smoke-pack-");
  const installDir = makeTempRoot("mdgraph-pack-smoke-install-");
  const pack = runNpm(["pack", "--json", "--pack-destination", packDir], { cwd: repoRoot });
  const packInfo = parsePackInfo(pack.stdout);
  if (!packInfo.filename.endsWith(".tgz")) {
    throw new Error(`npm pack did not report a tarball name. stdout:\n${pack.stdout}`);
  }
  const tarballPath = path.join(packDir, packInfo.filename);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Packed artifact not found: ${tarballPath}`);
  }

  const packedFiles = new Set(packInfo.files.map((file) => normalizePackPath(file.path)));
  const packageRoot = path.join(installDir, "node_modules", "mdgraph");
  copyPackedFiles(packInfo.files, packageRoot);
  linkRuntimeDependencies(installDir);

  const packedPackageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (packedPackageJson.bin?.mdgraph !== "dist/bin/mdgraph.js") {
    throw new Error(`Expected packed bin mdgraph to point at dist/bin/mdgraph.js, got ${packedPackageJson.bin?.mdgraph ?? "missing"}`);
  }

  assertPackedFile(packedFiles, "dist/bin/mdgraph.js");
  assertPackedFile(packedFiles, "dist/index.js");
  const installedCliPath = path.join(packageRoot, "dist", "bin", "mdgraph.js");
  const version = run(process.execPath, [installedCliPath, "--version"], { cwd: installDir }).stdout.trim();
  if (version !== packageJson.version) {
    throw new Error(`Expected packed mdgraph version ${packageJson.version}, got ${version}`);
  }
  const importSmokePath = path.join(installDir, "import-smoke.mjs");
  fs.writeFileSync(importSmokePath, [
    "const mod = await import('mdgraph');",
    "if (!mod.indexProject) {",
    "  throw new Error('missing indexProject export');",
    "}",
    ""
  ].join("\n"), "utf8");
  run(process.execPath, [importSmokePath], { cwd: installDir });
  assertPackedFile(packedFiles, "agent-pack/mdgraph-agent-instructions.md");
  assertPackedFile(packedFiles, "agent-pack/host-examples.md");
  assertPackedFile(packedFiles, "agent-pack/mcp-config.example.json");
  assertPackedFile(packedFiles, "agent-pack/prompts/status-doctor.md");
  assertPackedFile(packedFiles, "docs/EN/Agent_Integration.md");
  assertPackedFile(packedFiles, "docs/EN/Agent_File_Read_Comparison.md");
} finally {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeTempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function runNpm(args, options) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) {
    throw new Error("npm_execpath is not set; run this smoke test through npm scripts");
  }
  return run(process.execPath, [npmCliPath, ...args], options);
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      `cwd: ${options.cwd}`,
      `exit: ${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n"));
  }
  return result;
}

function parsePackInfo(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(`npm pack did not return JSON. stdout:\n${stdout}`);
  }
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    typeof value[0]?.filename !== "string" ||
    !Array.isArray(value[0]?.files)
  ) {
    throw new Error(`npm pack returned unexpected JSON. stdout:\n${stdout}`);
  }
  return value[0];
}

function copyPackedFiles(files, packageRoot) {
  for (const file of files) {
    const relativePath = normalizePackPath(file.path);
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(packageRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Packed file is missing from workspace: ${relativePath}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function linkRuntimeDependencies(installDir) {
  const nodeModulesDir = path.join(installDir, "node_modules");
  for (const dependency of Object.keys(packageJson.dependencies ?? {}).sort()) {
    const sourcePath = path.join(repoRoot, "node_modules", ...dependency.split("/"));
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Runtime dependency is not installed: ${dependency}. Run npm install before smoke:pack.`);
    }
    const targetPath = path.join(nodeModulesDir, ...dependency.split("/"));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const symlinkType = fs.statSync(sourcePath).isDirectory() && process.platform === "win32"
      ? "junction"
      : undefined;
    fs.symlinkSync(sourcePath, targetPath, symlinkType);
  }
}

function normalizePackPath(relativePath) {
  const normalized = relativePath.split(path.win32.sep).join(path.posix.sep);
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe packed path: ${relativePath}`);
  }
  return normalized;
}

function assertPackedFile(files, relativePath) {
  if (!files.has(relativePath)) {
    throw new Error(`Expected packed file: ${relativePath}`);
  }
}
