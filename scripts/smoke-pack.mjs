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
  const pack = runNpm(["pack", "--pack-destination", packDir], { cwd: repoRoot });
  const tarballName = pack.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!tarballName || !tarballName.endsWith(".tgz")) {
    throw new Error(`npm pack did not report a tarball name. stdout:\n${pack.stdout}`);
  }
  const tarballPath = path.join(packDir, tarballName);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Packed artifact not found: ${tarballPath}`);
  }

  runNpm(["init", "-y"], { cwd: installDir });
  runNpm(["install", tarballPath], { cwd: installDir });
  const installedCliPath = path.join(installDir, "node_modules", "mdgraph", "dist", "bin", "mdgraph.js");
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
  assertInstalledFile(installDir, "node_modules/mdgraph/agent-pack/mdgraph-agent-instructions.md");
  assertInstalledFile(installDir, "node_modules/mdgraph/agent-pack/host-examples.md");
  assertInstalledFile(installDir, "node_modules/mdgraph/agent-pack/mcp-config.example.json");
  assertInstalledFile(installDir, "node_modules/mdgraph/agent-pack/prompts/status-doctor.md");
  assertInstalledFile(installDir, "node_modules/mdgraph/docs/EN/Agent_Integration.md");
  assertInstalledFile(installDir, "node_modules/mdgraph/docs/EN/Agent_File_Read_Comparison.md");
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

function assertInstalledFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected packed file to be installed: ${relativePath}`);
  }
}