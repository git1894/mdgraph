import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateGraphDiff } from "../src/diff/graph-diff.js";
import { indexProject } from "../src/indexer.js";
import { generateReport } from "../src/reporting/report.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("v0.6.2 graph diff", () => {
  it("reports PR documentation graph impact without changing the current index", async () => {
    const root = makeTempRoot("mdgraph-diff-");
    createFixtureDocs(root);
    fs.mkdirSync(path.join(root, "src", "auth"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "auth", "AuthService.ts"), "export class AuthService {}\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "old-name.md"), [
      "---",
      "id: old-name",
      "title: Old Name",
      "type: spec",
      "defines:",
      "  - RenameTarget",
      "---",
      "# Old Name",
      "",
      "RenameTarget documents the old flow.",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(root, "docs", "delete-me.md"), "# Delete Me\n\nThis doc will be removed.\n", "utf8");
    initGit(root);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "base docs"]);

    fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## Added Impact\n\nAuthService now references AddedImpact.\n", "utf8");
    fs.renameSync(path.join(root, "docs", "old-name.md"), path.join(root, "docs", "new-name.md"));
    fs.rmSync(path.join(root, "docs", "delete-me.md"));
    fs.writeFileSync(path.join(root, "docs", "new-source.md"), [
      "---",
      "id: new-source",
      "title: New Source",
      "type: spec",
      "source_refs:",
      "  - src/new.ts",
      "---",
      "# New Source",
      "",
      "Tracks `src/new.ts`.",
      ""
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(root, "src", "new.ts"), "export const newFeature = true;\n", "utf8");
    runGit(root, ["add", "-A"]);
    await indexProject(root, { full: true });
    const currentDbBytes = fs.statSync(path.join(root, ".mdgraph", "graph.db")).size;

    const diff = await generateGraphDiff(root, { base: "HEAD" });

    expect(diff.mode).toBe("base_ref");
    expect(diff.summary.documentsAdded).toBe(1);
    expect(diff.summary.documentsModified).toBeGreaterThanOrEqual(1);
    expect(diff.summary.documentsDeleted).toBe(1);
    expect(diff.summary.documentsRenamed).toBe(1);
    expect(diff.summary.sectionsChanged).toBeGreaterThan(0);
    expect(diff.summary.sourceRefsChanged).toBeGreaterThan(0);
    expect(diff.impact.changedSourceRefs).toContain("src/new.ts");
    expect(diff.documents.some((document) => document.change === "renamed" && document.previousPath === "docs/old-name.md" && document.path === "docs/new-name.md")).toBe(true);
    expect(diff.impact.prSummary.length).toBeGreaterThan(0);
    expect(fs.statSync(path.join(root, ".mdgraph", "graph.db")).size).toBe(currentDbBytes);
  }, 15000);

  it("embeds graph diff in report output", async () => {
    const root = makeTempRoot("mdgraph-report-diff-");
    createFixtureDocs(root);
    initGit(root);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "base docs"]);
    fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## Report Diff\n\nReportDiff adds a section.\n", "utf8");
    await indexProject(root, { full: true });

    const report = await generateReport(root, { base: "HEAD" });

    expect(report.diff?.summary.documentsModified).toBe(1);
    expect(report.diff?.impact.prSummary.length).toBeGreaterThan(0);
  }, 15000);

  it("fails clearly for invalid base refs", async () => {
    const root = makeTempRoot("mdgraph-diff-invalid-");
    createFixtureDocs(root);
    initGit(root);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "base docs"]);
    await indexProject(root, { full: true });

    await expect(generateGraphDiff(root, { base: "missing-ref" })).rejects.toThrow(/Git command failed/);
  }, 15000);
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function initGit(root: string): void {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "mdgraph@example.test"]);
  runGit(root, ["config", "user.name", "MDGraph Test"]);
}

function runGit(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}
