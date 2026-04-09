import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { countModuleLocAtRevision } from "./loc-counter.js";

const execFileAsync = promisify(execFile);

test("countModuleLocAtRevision preserves totals across concurrency levels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-loc-counter-test-"));
  const repoPath = join(dir, "repo");

  try {
    await mkdir(join(repoPath, "src"), { recursive: true });
    await writeFile(join(repoPath, "src/a.ts"), ["export const a = 1;", "", "a;", ""].join("\n"));
    await writeFile(join(repoPath, "src/b.ts"), ["export const b = 2;", "b;", ""].join("\n"));

    await git(repoPath, ["init"]);
    await git(repoPath, ["config", "user.name", "Codex"]);
    await git(repoPath, ["config", "user.email", "codex@example.com"]);
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "initial"], "2026-04-01T00:00:00Z");

    const serial = await countModuleLocAtRevision({
      localPath: repoPath,
      revision: "HEAD",
      modules: [
        {
          key: "module:one",
          files: ["src/a.ts", "src/b.ts"],
        },
      ],
      concurrency: 1,
    });

    const parallel = await countModuleLocAtRevision({
      localPath: repoPath,
      revision: "HEAD",
      modules: [
        {
          key: "module:one",
          files: ["src/a.ts", "src/b.ts"],
        },
      ],
      concurrency: 4,
    });

    assert.equal(serial.get("module:one"), 4);
    assert.equal(parallel.get("module:one"), 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
