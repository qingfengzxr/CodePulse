import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateConcurrentSnapshotEtaSeconds,
  estimateSnapshotEtaSeconds,
} from "./progress-estimate.js";

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

test("estimateConcurrentSnapshotEtaSeconds returns null before any progress exists", () => {
  const etaSeconds = estimateConcurrentSnapshotEtaSeconds({
    sampledCommits: 4,
    snapshots: [
      { totalWorkUnits: 0, processedWorkUnits: 0, completed: false },
      { totalWorkUnits: 0, processedWorkUnits: 0, completed: false },
      { totalWorkUnits: 0, processedWorkUnits: 0, completed: false },
      { totalWorkUnits: 0, processedWorkUnits: 0, completed: false },
    ],
    startedAtMs: 0,
    nowMs: 10_000,
  });

  assert.equal(etaSeconds, null);
});

test("estimateConcurrentSnapshotEtaSeconds uses global completion fraction", () => {
  const etaSeconds = estimateConcurrentSnapshotEtaSeconds({
    sampledCommits: 4,
    snapshots: [
      { totalWorkUnits: 100, processedWorkUnits: 100, completed: true },
      { totalWorkUnits: 100, processedWorkUnits: 50, completed: false },
      { totalWorkUnits: 0, processedWorkUnits: 0, completed: false },
      { totalWorkUnits: 0, processedWorkUnits: 0, completed: false },
    ],
    startedAtMs: 0,
    nowMs: 60_000,
  });

  assert.equal(etaSeconds, 100);
});

test("estimateConcurrentSnapshotEtaSeconds returns zero when all snapshots complete", () => {
  const etaSeconds = estimateConcurrentSnapshotEtaSeconds({
    sampledCommits: 2,
    snapshots: [
      { totalWorkUnits: 100, processedWorkUnits: 100, completed: true },
      { totalWorkUnits: 80, processedWorkUnits: 80, completed: true },
    ],
    startedAtMs: 0,
    nowMs: 60_000,
  });

  assert.equal(etaSeconds, 0);
});
