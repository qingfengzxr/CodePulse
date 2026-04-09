import test from "node:test";
import assert from "node:assert/strict";

import { sampleCommits } from "./index.js";

test("sampleCommits keeps every commit for per-commit sampling", () => {
  const commits = [
    { hash: "aaa111", committedAt: "2026-04-01T00:00:00.000Z" },
    { hash: "bbb222", committedAt: "2026-04-01T06:00:00.000Z" },
    { hash: "ccc333", committedAt: "2026-04-02T00:00:00.000Z" },
  ];

  const sampled = sampleCommits(commits, "per-commit");

  assert.deepEqual(sampled, commits);
});
