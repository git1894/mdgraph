import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tasksRoot = path.join(repoRoot, "docs", "tasks");
const allowedPublicTaskFiles = new Set([
  "docs/tasks/.gitignore",
  "docs/tasks/README.md"
]);

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "new":
      createTask(args);
      break;
    case "check":
      runTaskCheck(args);
      break;
    case "smoke":
      runCommandChain([
        ["npm run smoke:cli", "npm", ["run", "smoke:cli"]],
        ["npm run smoke:eval", "npm", ["run", "smoke:eval"]],
        ["npm run smoke:pack", "npm", ["run", "smoke:pack"]]
      ]);
      break;
    case "public-check":
      runPublicCheck();
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function createTask(args) {
  const title = args.join(" ").trim();
  if (!title) {
    throw new Error("Usage: npm run task:new -- \"Short task title\"");
  }

  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(title);
  const taskDir = uniqueTaskDir(`${date}-${slug}`);
  const taskName = path.basename(taskDir);

  fs.mkdirSync(taskDir, { recursive: true });
  writeTaskFile(taskDir, "prd.md", prdTemplate(title, date, taskName));
  writeTaskFile(taskDir, "design.md", `# Design: ${title}\n\n## 方法\n\nTBD.\n\n## 风险\n\nTBD.\n`);
  writeTaskFile(taskDir, "plan.md", `# Plan: ${title}\n\n1. TBD.\n`);
  writeTaskFile(taskDir, "check.md", `# Check: ${title}\n\n## Required Verification\n\n- [ ] TBD.\n\n## Results\n\nPending.\n`);
  writeTaskFile(taskDir, "notes.md", `# Notes: ${title}\n\n## Decisions\n\n- TBD.\n`);

  console.log(path.relative(repoRoot, taskDir).replaceAll(path.sep, "/"));
}

function runTaskCheck(args) {
  const taskDir = parseTaskDir(args);
  const results = runCommandChain([
    ["npm run typecheck", "npm", ["run", "typecheck"]],
    ["npm test", "npm", ["test"]],
    ["npm run build", "npm", ["run", "build"]]
  ], { stopOnFailure: true });

  if (taskDir) {
    appendCheckResults(taskDir, results);
  }

  const failed = results.find((result) => result.exitCode !== 0);
  if (failed) {
    process.exitCode = failed.exitCode;
  }
}

function runPublicCheck() {
  const tracked = runCapture("git", ["ls-files", "docs/tasks"]);
  const trackedTaskArtifacts = lines(tracked.stdout)
    .map(normalizeGitPath)
    .filter((filePath) => !allowedPublicTaskFiles.has(filePath));

  const unignored = runCapture("git", ["ls-files", "--others", "--exclude-standard", "docs/tasks"]);
  const unignoredTaskArtifacts = lines(unignored.stdout).map(normalizeGitPath);

  const status = runCapture("git", ["status", "--short", "--", "docs/tasks"]);
  const publicStatus = lines(status.stdout)
    .map((line) => ({ line, filePath: normalizeGitPath(line.slice(3).trim()) }))
    .filter((entry) => !allowedPublicTaskFiles.has(entry.filePath));

  if (trackedTaskArtifacts.length > 0 || unignoredTaskArtifacts.length > 0 || publicStatus.length > 0) {
    throw new Error([
      "docs/tasks contains public task artifacts.",
      formatList("tracked task artifacts", trackedTaskArtifacts),
      formatList("unignored task artifacts", unignoredTaskArtifacts),
      formatList("public task status", publicStatus.map((entry) => entry.line)),
      "Keep task directories ignored, or extract durable decisions into public docs."
    ].filter(Boolean).join("\n"));
  }

  console.log("docs/tasks public check passed");
}

function runCommandChain(commands, options = {}) {
  const results = [];
  for (const [label, executable, commandArgs] of commands) {
    console.log(`\n> ${label}`);
    const result = spawnSync(executable, commandArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: "inherit",
      windowsHide: true
    });
    const exitCode = result.status ?? 1;
    results.push({ command: label, exitCode });
    if (exitCode !== 0 && options.stopOnFailure) {
      break;
    }
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      break;
    }
  }
  return results;
}

function runCapture(executable, commandArgs) {
  const result = spawnSync(executable, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${executable} ${commandArgs.join(" ")}`,
      `exit: ${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n"));
  }
  return result;
}

function parseTaskDir(args) {
  const taskIndex = args.indexOf("--task");
  if (taskIndex === -1) {
    return undefined;
  }
  const taskPath = args[taskIndex + 1];
  if (!taskPath) {
    throw new Error("Expected a task directory after --task");
  }
  const taskDir = path.resolve(repoRoot, taskPath);
  const relative = path.relative(tasksRoot, taskDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("--task must point inside docs/tasks");
  }
  const checkFile = path.join(taskDir, "check.md");
  if (!fs.existsSync(checkFile)) {
    throw new Error(`${path.relative(repoRoot, checkFile)} does not exist`);
  }
  return taskDir;
}

function appendCheckResults(taskDir, results) {
  const checkFile = path.join(taskDir, "check.md");
  const timestamp = new Date().toISOString();
  const rows = results.map((result) => {
    const status = result.exitCode === 0 ? "passed" : `failed (${result.exitCode})`;
    return `| \`${result.command}\` | ${status} | exit code ${result.exitCode} |`;
  }).join("\n");
  fs.appendFileSync(checkFile, [
    "",
    `## Recorded Results - ${timestamp}`,
    "",
    "| Command | Result | Evidence |",
    "|---|---|---|",
    rows,
    ""
  ].join("\n"), "utf8");
}

function writeTaskFile(taskDir, fileName, content) {
  fs.writeFileSync(path.join(taskDir, fileName), content, "utf8");
}

function prdTemplate(title, date, taskName) {
  return [
    `# ${title}`,
    "",
    "Status: draft",
    `Created: ${date}`,
    `Task: ${taskName}`,
    "Risk: TBD",
    "Owner: agent",
    "Reviewer: maintainer",
    "",
    "## 问题",
    "",
    "TBD.",
    "",
    "## 目标",
    "",
    "- TBD.",
    "",
    "## 非目标",
    "",
    "- TBD.",
    "",
    "## 验收标准",
    "",
    "- [ ] TBD.",
    "",
    "## 参考",
    "",
    "- TBD.",
    ""
  ].join("\n");
}

function uniqueTaskDir(baseName) {
  let candidate = path.join(tasksRoot, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(tasksRoot, `${baseName}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "task";
}

function lines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function normalizeGitPath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function formatList(title, values) {
  if (values.length === 0) {
    return "";
  }
  return `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function printUsage() {
  console.log([
    "Usage:",
    "  npm run task:new -- \"Short task title\"",
    "  npm run task:check -- [--task docs/tasks/YYYY-MM-DD-slug]",
    "  npm run task:smoke",
    "  npm run task:public-check"
  ].join("\n"));
}