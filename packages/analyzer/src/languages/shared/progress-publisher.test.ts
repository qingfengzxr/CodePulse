import test from "node:test";
import assert from "node:assert/strict";

import { createProgressPublisher } from "./progress-publisher.js";
import type { AnalyzeRepositoryHistoryInput } from "./types.js";

function createInput(progressThrottleMs: number, onProgress: (phase: string) => void) {
  const input: AnalyzeRepositoryHistoryInput = {
    analysisId: "analysis-1",
    localPath: "/tmp/repo",
    branch: "HEAD",
    sampling: "weekly",
    detectedKinds: ["node"],
    startedAt: "2026-04-09T00:00:00.000Z",
    performance: {
      progressThrottleMs,
    },
    onProgress: async (progress) => onProgress(progress.phase),
  };

  return input;
}

test("progress publisher throttles repeated snapshot progress updates", async () => {
  const phases: string[] = [];
  const publish = createProgressPublisher(
    createInput(10_000, (phase) => {
      phases.push(phase);
    }),
  );

  await publish({
    phase: "analyzing-snapshots",
    percent: 11,
    totalCommits: 10,
    sampledCommits: 2,
    completedSnapshots: 0,
    currentCommit: "aaa111",
    currentModule: "web",
    currentFiles: 10,
    processedFiles: 1,
    etaSeconds: 10,
    startedAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:00.000Z",
  });
  await publish({
    phase: "analyzing-snapshots",
    percent: 12,
    totalCommits: 10,
    sampledCommits: 2,
    completedSnapshots: 0,
    currentCommit: "aaa111",
    currentModule: "web",
    currentFiles: 10,
    processedFiles: 2,
    etaSeconds: 9,
    startedAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:01.000Z",
  });

  assert.deepEqual(phases, ["analyzing-snapshots"]);
});

test("progress publisher always forwards phase changes and completed snapshot boundaries", async () => {
  const phases: string[] = [];
  const publish = createProgressPublisher(
    createInput(10_000, (phase) => {
      phases.push(phase);
    }),
  );

  await publish({
    phase: "analyzing-snapshots",
    percent: 50,
    totalCommits: 10,
    sampledCommits: 2,
    completedSnapshots: 0,
    currentCommit: "aaa111",
    currentModule: "web",
    currentFiles: 10,
    processedFiles: 5,
    etaSeconds: 5,
    startedAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:00.000Z",
  });
  await publish({
    phase: "analyzing-snapshots",
    percent: 95,
    totalCommits: 10,
    sampledCommits: 2,
    completedSnapshots: 1,
    currentCommit: "bbb222",
    currentModule: null,
    currentFiles: 10,
    processedFiles: 10,
    etaSeconds: 0,
    startedAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:01.000Z",
  });
  await publish({
    phase: "persisting",
    percent: 98,
    totalCommits: 10,
    sampledCommits: 2,
    completedSnapshots: 2,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: 0,
    startedAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:02.000Z",
  });

  assert.deepEqual(phases, ["analyzing-snapshots", "analyzing-snapshots", "persisting"]);
});
