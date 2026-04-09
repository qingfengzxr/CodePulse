type EstimateEtaInput = {
  sampledCommits: number;
  snapshotIndex: number;
  currentFiles: number;
  processedFiles: number;
  startedAtMs: number;
  currentSnapshotStartedAtMs: number;
  nowMs?: number;
  forceCompletedSnapshots?: number;
};

export function estimateSnapshotEtaSeconds(input: EstimateEtaInput) {
  const nowMs = input.nowMs ?? Date.now();
  const elapsedSeconds = Math.max((nowMs - input.startedAtMs) / 1000, 0.001);
  const currentSnapshotElapsedSeconds = Math.max(
    (nowMs - input.currentSnapshotStartedAtMs) / 1000,
    0.001,
  );

  const currentSnapshotRemainingUnits = Math.max(input.currentFiles - input.processedFiles, 0);
  const currentUnitSeconds =
    input.processedFiles > 0 ? currentSnapshotElapsedSeconds / input.processedFiles : null;
  const currentSnapshotEtaSeconds =
    currentUnitSeconds !== null
      ? Math.max(Math.ceil(currentUnitSeconds * currentSnapshotRemainingUnits), 0)
      : null;

  const remainingFutureSnapshots = Math.max(
    input.sampledCommits - (input.forceCompletedSnapshots ?? input.snapshotIndex + 1),
    0,
  );
  const completedSnapshotSeconds =
    input.forceCompletedSnapshots !== undefined
      ? elapsedSeconds
      : Math.max((input.currentSnapshotStartedAtMs - input.startedAtMs) / 1000, 0);
  const completedSnapshotCount = input.forceCompletedSnapshots ?? input.snapshotIndex;
  const averageCompletedSnapshotSeconds =
    completedSnapshotCount > 0 ? completedSnapshotSeconds / completedSnapshotCount : null;
  const futureSnapshotsEtaSeconds =
    averageCompletedSnapshotSeconds !== null
      ? Math.max(Math.ceil(averageCompletedSnapshotSeconds * remainingFutureSnapshots), 0)
      : null;

  if (currentSnapshotEtaSeconds === null && futureSnapshotsEtaSeconds === null) {
    return null;
  }

  return (currentSnapshotEtaSeconds ?? 0) + (futureSnapshotsEtaSeconds ?? 0);
}
