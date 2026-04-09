import test from "node:test";
import assert from "node:assert/strict";

import { estimateSnapshotEtaSeconds } from "./progress-estimate.js";

test("estimateSnapshotEtaSeconds uses current snapshot only before first snapshot completes", () => {
  const etaSeconds = estimateSnapshotEtaSeconds({
    sampledCommits: 10,
    snapshotIndex: 0,
    currentFiles: 100,
    processedFiles: 25,
    startedAtMs: 0,
    currentSnapshotStartedAtMs: 0,
    nowMs: 50_000,
  });

  assert.equal(etaSeconds, 150);
});

test("estimateSnapshotEtaSeconds includes future snapshots after completed history exists", () => {
  const etaSeconds = estimateSnapshotEtaSeconds({
    sampledCommits: 10,
    snapshotIndex: 3,
    currentFiles: 100,
    processedFiles: 50,
    startedAtMs: 0,
    currentSnapshotStartedAtMs: 90_000,
    nowMs: 120_000,
  });

  assert.equal(etaSeconds, 210);
});

test("estimateSnapshotEtaSeconds uses completed snapshot average after finishing current snapshot", () => {
  const etaSeconds = estimateSnapshotEtaSeconds({
    sampledCommits: 10,
    snapshotIndex: 3,
    currentFiles: 100,
    processedFiles: 100,
    startedAtMs: 0,
    currentSnapshotStartedAtMs: 90_000,
    nowMs: 120_000,
    forceCompletedSnapshots: 4,
  });

  assert.equal(etaSeconds, 180);
});
