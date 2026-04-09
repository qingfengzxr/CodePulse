import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, chmod, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("git text read cache is stable within a process", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "code-dance-git-test-"));
  const binDir = join(tempDir, "bin");
  const logFile = join(tempDir, "git-invocations.log");
  const gitBinary = join(binDir, "git");
  const originalPath = process.env.PATH ?? "";

  await mkdir(binDir, { recursive: true });
  await writeFile(
    gitBinary,
    `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$LOG_FILE"
if [ "$3" = "show" ]; then
  last=""
  for arg in "$@"; do
    last="$arg"
  done
  case "$last" in
    *src/a.ts) printf '%s' "content-a" ;;
    *src/b.ts) printf '%s' "content-b" ;;
    *) printf '%s' "cached content" ;;
  esac
  exit 0
fi

if [ "$3" = "cat-file" ]; then
  while IFS= read -r spec; do
    case "$spec" in
      *src/a.ts) content="content-a" ;;
      *src/b.ts) content="content-b" ;;
      *) content="cached content" ;;
    esac
    size=$(printf '%s' "$content" | wc -c | tr -d ' ')
    printf 'deadbeef blob %s\n%s\n' "$size" "$content"
  done
  exit 0
fi
`,
    "utf8",
  );
  await chmod(gitBinary, 0o755);

  process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath}`;
  process.env.LOG_FILE = logFile;

  try {
    const git = await import("./index.js");

    await t.test("deduplicates concurrent reads for the same key", async () => {
      const startCount = await countLogLines(logFile);

      const [first, second] = await Promise.all([
        git.readTextFileAtRevision("/repo", "rev-a", "src/lib.ts"),
        git.readTextFileAtRevision("/repo", "rev-a", "src/lib.ts"),
      ]);

      assert.equal(first, "cached content");
      assert.equal(second, "cached content");
      assert.equal(await countLogLines(logFile), startCount + 1);
    });

    await t.test("keeps different keys isolated", async () => {
      const startCount = await countLogLines(logFile);

      const [first, second] = await Promise.all([
        git.readTextFileAtRevision("/repo", "rev-a", "src/a.ts"),
        git.readTextFileAtRevision("/repo", "rev-a", "src/b.ts"),
      ]);

      assert.equal(first, "content-a");
      assert.equal(second, "content-b");
      assert.equal(await countLogLines(logFile), startCount + 2);
    });

    await t.test("clears completed reads instead of retaining them forever", async () => {
      const startCount = await countLogLines(logFile);

      const first = await git.readTextFileAtRevision("/repo", "rev-a", "src/lib.ts");
      const second = await git.readTextFileAtRevision("/repo", "rev-a", "src/lib.ts");

      assert.equal(first, "cached content");
      assert.equal(second, "cached content");
      assert.equal(await countLogLines(logFile), startCount + 2);
    });

    await t.test("sampleCommits keeps every commit for per-commit sampling", async () => {
      const commits = [
        { hash: "aaa111", committedAt: "2026-04-01T00:00:00.000Z" },
        { hash: "bbb222", committedAt: "2026-04-01T06:00:00.000Z" },
        { hash: "ccc333", committedAt: "2026-04-02T00:00:00.000Z" },
      ];

      const sampled = git.sampleCommits(commits, "per-commit");

      assert.deepEqual(sampled, commits);
    });

    await t.test("batch revision text reader serves multiple files through one git process", async () => {
      const startCount = await countLogLines(logFile);
      const reader = git.createRevisionTextFileReader("/repo", "rev-a");

      try {
        const [first, second] = await Promise.all([
          reader.readTextFile("src/a.ts"),
          reader.readTextFile("src/b.ts"),
        ]);

        assert.equal(first, "content-a");
        assert.equal(second, "content-b");
      } finally {
        await reader.close();
      }

      const lines = await readLogLines(logFile);
      const added = lines.slice(startCount);
      const catFileInvocations = added.filter((line) => line.includes("cat-file --batch"));
      assert.equal(catFileInvocations.length, 1);
    });
  } finally {
    process.env.PATH = originalPath;
    delete process.env.LOG_FILE;
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function countLogLines(logFile: string): Promise<number> {
  return (await readLogLines(logFile)).length;
}

async function readLogLines(logFile: string): Promise<string[]> {
  try {
    const content = await readFile(logFile, "utf8");
    return content.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
