import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { analyzeRepositoryHistory, detectRepositoryModules } from "./index.js";
import type { AnalyzeRepositoryHistoryOutput } from "./index.js";

const execFileAsync = promisify(execFile);

test("node/web analyzer detects workspace modules and analyzes ts html css history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-analyzer-node-test-"));
  const repoPath = join(dir, "frontend-repo");

  try {
    await mkdir(repoPath);
    await mkdir(join(repoPath, "apps/web/src"), { recursive: true });
    await mkdir(join(repoPath, "packages/ui/src"), { recursive: true });

    await writeFile(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "frontend-repo",
          private: true,
          workspaces: ["apps/*", "packages/*"],
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(repoPath, "apps/web/package.json"),
      JSON.stringify({ name: "web" }, null, 2),
    );
    await writeFile(
      join(repoPath, "packages/ui/package.json"),
      JSON.stringify({ name: "ui" }, null, 2),
    );
    await writeFile(
      join(repoPath, "apps/web/src/app.tsx"),
      ["export function App() {", "  return <main>Hello</main>;", "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "packages/ui/src/button.ts"),
      ["export function Button() {", '  return "button";', "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "packages/ui/src/styles.css"),
      [".button {", "  color: red;", "}", ""].join("\n"),
    );

    await git(repoPath, ["init"]);
    await git(repoPath, ["config", "user.name", "Codex"]);
    await git(repoPath, ["config", "user.email", "codex@example.com"]);
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "initial frontend"], "2026-04-01T00:00:00Z");

    await writeFile(
      join(repoPath, "apps/web/src/app.tsx"),
      ["export function App() {", "  return <main>Hello frontend</main>;", "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "apps/web/src/index.html"),
      ["<main>", '  <div id="app"></div>', "</main>", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "packages/ui/src/styles.css"),
      [".button {", "  color: blue;", "  font-weight: 600;", "}", ""].join("\n"),
    );
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "expand frontend"], "2026-04-08T00:00:00Z");

    const modules = await detectRepositoryModules({
      localPath: repoPath,
      detectedKinds: ["node"],
    });

    assert.deepEqual(
      modules.map((module) => module.key),
      ["node:package:ui", "node:package:web"],
    );
    assert.ok(modules.every((module) => module.files.length > 0));
    assert.ok(modules.some((module) => module.files.includes("apps/web/src/index.html")));
    assert.ok(modules.some((module) => module.files.includes("packages/ui/src/styles.css")));

    const result = await analyzeRepositoryHistory({
      analysisId: "analysis-node-1",
      localPath: repoPath,
      branch: "HEAD",
      sampling: "weekly",
      detectedKinds: ["node"],
      startedAt: "2026-04-09T00:00:00.000Z",
    });

    assert.equal(result.snapshots.length, 2);
    assert.equal(result.points.length, 4);

    const latestWebPoint = result.points.find(
      (point) => point.moduleKey === "node:package:web" && point.ts === "2026-04-08T00:00:00+00:00",
    );
    const latestUiPoint = result.points.find(
      (point) => point.moduleKey === "node:package:ui" && point.ts === "2026-04-08T00:00:00+00:00",
    );

    assert.ok(latestWebPoint);
    assert.ok(latestUiPoint);
    assert.equal(latestWebPoint.loc, 6);
    assert.equal(latestUiPoint.loc, 7);
    assert.ok(latestWebPoint.churn > 0);
    assert.ok(latestUiPoint.churn > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("node/web analyzer falls back to directory modules when workspace is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-analyzer-node-fallback-test-"));
  const repoPath = join(dir, "fallback-repo");

  try {
    await mkdir(join(repoPath, "apps/browser"), { recursive: true });
    await mkdir(join(repoPath, "os/config"), { recursive: true });
    await mkdir(join(repoPath, "components"), { recursive: true });

    await writeFile(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "cos",
          private: true,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(repoPath, "App.tsx"),
      ["export function App() {", "  return <main>root</main>;", "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "apps/browser/BrowserApp.tsx"),
      ["export function BrowserApp() {", "  return <section>browser</section>;", "}", ""].join(
        "\n",
      ),
    );
    await writeFile(
      join(repoPath, "os/config/index.ts"),
      ["export const runtimeConfig = {", '  mode: "demo",', "};", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "components/Widget.tsx"),
      ["export function Widget() {", "  return <div>widget</div>;", "}", ""].join("\n"),
    );

    const modules = await detectRepositoryModules({
      localPath: repoPath,
      detectedKinds: ["node"],
    });

    assert.deepEqual(modules.map((module) => module.key).sort(), [
      "node:package:apps-browser",
      "node:package:components",
      "node:package:cos",
      "node:package:os-config",
    ]);
    assert.ok(modules.some((module) => module.name === "apps/browser"));
    assert.ok(modules.some((module) => module.name === "os/config"));
    assert.ok(modules.some((module) => module.name === "components"));
    assert.ok(modules.some((module) => module.name === "cos"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mixed rust and node repository aggregates analyzer outputs into one result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-analyzer-mixed-test-"));
  const repoPath = join(dir, "mixed-repo");

  try {
    await mkdir(join(repoPath, "crates/core/src"), { recursive: true });
    await mkdir(join(repoPath, "apps/web/src"), { recursive: true });

    await writeFile(
      join(repoPath, "Cargo.toml"),
      ["[workspace]", 'members = ["crates/*"]', ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "crates/core/Cargo.toml"),
      ["[package]", 'name = "core"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "crates/core/src/lib.rs"),
      ["pub fn value() -> i32 {", "    1", "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "mixed-repo",
          private: true,
          workspaces: ["apps/*"],
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(repoPath, "apps/web/package.json"),
      JSON.stringify({ name: "web" }, null, 2),
    );
    await writeFile(
      join(repoPath, "apps/web/src/app.tsx"),
      ["export function App() {", "  return <main>Hello</main>;", "}", ""].join("\n"),
    );

    await git(repoPath, ["init"]);
    await git(repoPath, ["config", "user.name", "Codex"]);
    await git(repoPath, ["config", "user.email", "codex@example.com"]);
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "initial mixed"], "2026-04-01T00:00:00Z");

    await writeFile(
      join(repoPath, "crates/core/src/lib.rs"),
      ["pub fn value() -> i32 {", "    2", "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "apps/web/src/app.tsx"),
      ["export function App() {", "  return <main>Hello mixed</main>;", "}", ""].join("\n"),
    );
    await writeFile(
      join(repoPath, "apps/web/src/index.html"),
      ["<main>", '  <div id="app"></div>', "</main>", ""].join("\n"),
    );
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "update mixed"], "2026-04-08T00:00:00Z");

    const result = await analyzeRepositoryHistory({
      analysisId: "analysis-mixed-1",
      localPath: repoPath,
      branch: "HEAD",
      sampling: "weekly",
      detectedKinds: ["rust", "node"],
      startedAt: "2026-04-09T00:00:00.000Z",
    });

    assert.equal(result.snapshots.length, 2);
    assert.ok(result.points.some((point) => point.moduleKey.startsWith("rust:crate:")));
    assert.ok(result.points.some((point) => point.moduleKey.startsWith("node:package:")));
    assert.ok(result.points.every((point) => point.moduleKey.includes(":")));

    const latestRustPoint = result.points.find(
      (point) => point.moduleKey === "rust:crate:core" && point.ts === "2026-04-08T00:00:00+00:00",
    );
    const latestNodePoint = result.points.find(
      (point) => point.moduleKey === "node:package:web" && point.ts === "2026-04-08T00:00:00+00:00",
    );

    assert.ok(latestRustPoint);
    assert.ok(latestNodePoint);
    assert.ok(latestRustPoint.loc > 0);
    assert.ok(latestNodePoint.loc > 0);
    assert.ok(latestRustPoint.churn > 0);
    assert.ok(latestNodePoint.churn > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("aggregate analyzer fails when snapshot timelines do not match", async () => {
  const baseline: AnalyzeRepositoryHistoryOutput = {
    snapshots: [
      { analysisId: "a1", commit: "aaa111", ts: "2026-04-01T00:00:00.000Z" },
      { analysisId: "a1", commit: "bbb222", ts: "2026-04-08T00:00:00.000Z" },
    ],
    points: [],
    candles: [],
  };
  const mismatch: AnalyzeRepositoryHistoryOutput = {
    snapshots: [
      { analysisId: "a1", commit: "aaa111", ts: "2026-04-01T00:00:00.000Z" },
      { analysisId: "a1", commit: "ccc333", ts: "2026-04-15T00:00:00.000Z" },
    ],
    points: [],
    candles: [],
  };

  await assert.rejects(
    () =>
      analyzeRepositoryHistory({
        analysisId: "analysis-mismatch-1",
        localPath: "/tmp/unused",
        branch: "HEAD",
        sampling: "weekly",
        detectedKinds: ["rust", "node"],
        startedAt: "2026-04-09T00:00:00.000Z",
        onProgress: undefined,
        __testOverrides: {
          rust: async () => baseline,
          node: async () => mismatch,
        },
      }),
    /snapshot timeline mismatch/i,
  );
});

async function git(cwd: string, args: string[], authorDate?: string) {
  await execFileAsync("git", args, {
    cwd,
    env: authorDate
      ? {
          ...process.env,
          GIT_AUTHOR_DATE: authorDate,
          GIT_COMMITTER_DATE: authorDate,
        }
      : process.env,
  });
}
