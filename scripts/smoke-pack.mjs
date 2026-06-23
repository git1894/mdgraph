import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoots = [];

try {
  const packDir = makeTempRoot("mdgraph-pack-smoke-pack-");
  const installDir = makeTempRoot("mdgraph-pack-smoke-install-");
  const pack = run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot });
  const tarballName = pack.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!tarballName || !tarballName.endsWith(".tgz")) {
    throw new Error(`npm pack did not report a tarball name. stdout:\n${pack.stdout}`);
  }
  const tarballPath = path.join(packDir, tarballName);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Packed artifact not found: ${tarballPath}`);
  }

  run("npm", ["init", "-y"], { cwd: installDir });
  run("npm", ["install", tarballPath], { cwd: installDir });
  const version = run("npx", ["mdgraph", "--version"], { cwd: installDir }).stdout.trim();
  if (version !== "0.1.0") {
    throw new Error(`Expected packed mdgraph version 0.1.0, got ${version}`);
  }
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

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
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