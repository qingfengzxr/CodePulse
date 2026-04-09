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

type AggregateSnapshotProgressEntry = {
  totalWorkUnits: number;
  processedWorkUnits: number;
  completed: boolean;
};

type EstimateConcurrentEtaInput = {
  sampledCommits: number;
  snapshots: AggregateSnapshotProgressEntry[];
  startedAtMs: number;
  nowMs?: number;
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

export function estimateConcurrentSnapshotEtaSeconds(input: EstimateConcurrentEtaInput) {
  const nowMs = input.nowMs ?? Date.now();
  const elapsedSeconds = Math.max((nowMs - input.startedAtMs) / 1000, 0.001);
  const completedFraction =
    input.snapshots.reduce((sum, snapshot) => {
      if (snapshot.completed) {
        return sum + 1;
      }

      if (snapshot.totalWorkUnits <= 0) {
        return sum;
      }

      return sum + Math.min(snapshot.processedWorkUnits / snapshot.totalWorkUnits, 1);
    }, 0) / Math.max(input.sampledCommits, 1);

  if (completedFraction <= 0) {
    return null;
  }

  if (completedFraction >= 1) {
    return 0;
  }

  return Math.max(Math.ceil((elapsedSeconds * (1 - completedFraction)) / completedFraction), 0);
}
