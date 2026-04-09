import type {
  AnalysisProgress,
  MetricPoint,
  ModuleCandlePoint,
  ModuleUnit,
  Snapshot,
} from "@code-dance/domain";
import {
  bucketCommits,
  detectRustModulesAtRevision,
  listCommits,
  readNumstatBetweenRevisions,
} from "@code-dance/git";
import type { DiffStatRow, GitCommit } from "@code-dance/git";
import { countModuleLocAtRevision } from "../shared/loc-counter.js";
import { throwIfAborted } from "../shared/abort.js";
import { runWithConcurrency } from "../shared/concurrency.js";
import {
  estimateConcurrentSnapshotEtaSeconds,
  estimateSnapshotEtaSeconds,
} from "../shared/progress-estimate.js";
import { createProgressPublisher } from "../shared/progress-publisher.js";
import { resolveAnalyzerPerformanceOptions } from "../shared/runtime-options.js";
import type {
  AnalyzeRepositoryHistoryInput,
  AnalyzeRepositoryHistoryOutput,
} from "../shared/types.js";

export type AnalyzeRustHistoryInput = AnalyzeRepositoryHistoryInput;
export type AnalyzeRustHistoryOutput = AnalyzeRepositoryHistoryOutput;

export async function analyzeRustHistory(
  input: AnalyzeRustHistoryInput,
): Promise<AnalyzeRustHistoryOutput> {
  if (!input.detectedKinds.includes("rust")) {
    throw new Error("repository is not detected as rust");
  }

  const startedAtMs = Date.parse(input.startedAt);
  const publish = createProgressPublisher(input);
  const { fileReadConcurrency, snapshotConcurrency } = resolveAnalyzerPerformanceOptions(
    input.performance,
  );

  await publishProgress(publish, input, {
    phase: "validating",
    percent: 2,
    totalCommits: 0,
    sampledCommits: 0,
    completedSnapshots: 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: null,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
  });

  const commits = await listCommits(input.localPath, input.branch);

  await publishProgress(publish, input, {
    phase: "scanning-history",
    percent: 8,
    totalCommits: commits.length,
    sampledCommits: 0,
    completedSnapshots: 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: null,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
  });

  const commitBuckets = bucketCommits(commits, input.sampling);
  const sampledCommits = commitBuckets.map((bucket) => bucket[bucket.length - 1]!);

  if (sampledCommits.length === 0) {
    throw new Error("no commits found for analysis");
  }

  await publishProgress(publish, input, {
    phase: "sampling",
    percent: 10,
    totalCommits: commits.length,
    sampledCommits: sampledCommits.length,
    completedSnapshots: 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: null,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
  });

  const progressState = createAggregateSnapshotProgressState(sampledCommits.length);
  const rawResults: RustSnapshotResult[] = Array.from({ length: sampledCommits.length });

  await runWithConcurrency(
    sampledCommits.map((_, snapshotIndex) => async () => {
      rawResults[snapshotIndex] = await analyzeRustSnapshot({
        input,
        publish,
        startedAtMs,
        totalCommits: commits.length,
        sampledCommits,
        commitBuckets,
        snapshotIndex,
        fileReadConcurrency,
        progressState,
      });
    }),
    snapshotConcurrency,
  );

  const snapshots: Snapshot[] = [];
  const points: MetricPoint[] = [];
  const candles: ModuleCandlePoint[] = [];
  const previousModuleKeys = new Set<string>();

  for (const result of rawResults) {
    if (!result) {
      continue;
    }

    snapshots.push(result.snapshot);
    points.push(...result.points);
    candles.push(...result.candles);

    for (const moduleKey of previousModuleKeys) {
      if (result.moduleMetaByKey.has(moduleKey)) {
        continue;
      }

      points.push({
        analysisId: input.analysisId,
        ts: result.snapshot.ts,
        commit: result.snapshot.commit,
        moduleKey,
        moduleName: moduleKey.replace("rust:crate:", ""),
        moduleKind: "rust-crate",
        loc: 0,
        added: 0,
        deleted: 0,
        churn: 0,
      });
    }

    previousModuleKeys.clear();
    for (const moduleKey of result.moduleMetaByKey.keys()) {
      previousModuleKeys.add(moduleKey);
    }
  }

  await publishProgress(publish, input, {
    phase: "persisting",
    percent: 98,
    totalCommits: commits.length,
    sampledCommits: sampledCommits.length,
    completedSnapshots: sampledCommits.length,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: 0,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
  });

  return {
    snapshots,
    points: points.sort((left, right) => {
      const tsOrder = left.ts.localeCompare(right.ts);
      if (tsOrder !== 0) {
        return tsOrder;
      }

      return left.moduleKey.localeCompare(right.moduleKey);
    }),
    candles: candles.sort((left, right) => {
      const tsOrder = left.ts.localeCompare(right.ts);
      if (tsOrder !== 0) {
        return tsOrder;
      }

      return left.moduleKey.localeCompare(right.moduleKey);
    }),
  };
}

function countDistinctModuleFiles(modules: { files: string[] }[]): number {
  return new Set(modules.flatMap((module) => module.files)).size;
}

type RustSnapshotResult = {
  snapshot: Snapshot;
  points: MetricPoint[];
  candles: ModuleCandlePoint[];
  moduleMetaByKey: Map<string, { name: string; kind: string }>;
};

type AggregateSnapshotProgressState = {
  snapshots: Array<{
    totalWorkUnits: number;
    processedWorkUnits: number;
    currentCommit: string | null;
    currentModule: string | null;
    startedAtMs: number | null;
    completed: boolean;
  }>;
};

async function analyzeRustSnapshot(input: {
  input: AnalyzeRustHistoryInput;
  publish: ReturnType<typeof createProgressPublisher>;
  startedAtMs: number;
  totalCommits: number;
  sampledCommits: GitCommit[];
  commitBuckets: GitCommit[][];
  snapshotIndex: number;
  fileReadConcurrency: number;
  progressState: AggregateSnapshotProgressState;
}): Promise<RustSnapshotResult> {
  throwIfAborted(input.input.abortSignal);
  const commit = input.sampledCommits[input.snapshotIndex]!;
  const bucket = input.commitBuckets[input.snapshotIndex]!;
  const previousCommit = input.sampledCommits[input.snapshotIndex - 1] ?? null;
  const diffRows =
    previousCommit === null
      ? []
      : await readNumstatBetweenRevisions(input.input.localPath, previousCommit.hash, commit.hash);

  const currentSnapshotStartedAtMs = Date.now();
  const progressEntry = input.progressState.snapshots[input.snapshotIndex]!;
  progressEntry.totalWorkUnits = diffRows.length;
  progressEntry.processedWorkUnits = 0;
  progressEntry.currentCommit = commit.hash;
  progressEntry.currentModule = null;
  progressEntry.startedAtMs = currentSnapshotStartedAtMs;
  progressEntry.completed = false;

  const snapshot: Snapshot = {
    analysisId: input.input.analysisId,
    commit: commit.hash,
    ts: commit.committedAt,
  };

  const candleBoundaryCommits = getCandleBoundaryCommits(bucket, previousCommit, commit);
  const bucketStates: Array<{ commit: GitCommit; locByModule: Map<string, number> }> = [];
  const bucketModuleMetaByKey = new Map<string, { name: string; kind: string }>();
  let modules: ModuleUnit[] = [];
  let locByModule = new Map<string, number>();

  for (const bucketCommit of candleBoundaryCommits) {
    throwIfAborted(input.input.abortSignal);
    const bucketModules = await detectRustModulesAtRevision(input.input.localPath, bucketCommit.hash);
    throwIfAborted(input.input.abortSignal);
    progressEntry.totalWorkUnits += countDistinctModuleFiles(bucketModules);
    const moduleNameByKey = new Map(bucketModules.map((module) => [module.key, module.name]));
    const locAtCommit = await countModuleLocAtRevision({
      localPath: input.input.localPath,
      revision: bucketCommit.hash,
      modules: bucketModules,
      concurrency: input.fileReadConcurrency,
      abortSignal: input.input.abortSignal,
      onFileProcessed: async ({ moduleKey }) => {
        throwIfAborted(input.input.abortSignal);
        progressEntry.processedWorkUnits += 1;
        progressEntry.currentModule = moduleNameByKey.get(moduleKey) ?? null;
        await publishSnapshotProgress({
          publish: input.publish,
          input: input.input,
          totalCommits: input.totalCommits,
          sampledCommits: input.sampledCommits.length,
          snapshotIndex: input.snapshotIndex,
          currentCommit: commit.hash,
          currentModule: progressEntry.currentModule,
          currentFiles: progressEntry.totalWorkUnits,
          processedFiles: progressEntry.processedWorkUnits,
          startedAtMs: input.startedAtMs,
          currentSnapshotStartedAtMs,
          progressState: input.progressState,
        });
      },
    });

    for (const module of bucketModules) {
      bucketModuleMetaByKey.set(module.key, { name: module.name, kind: module.kind });
    }

    bucketStates.push({
      commit: bucketCommit,
      locByModule: locAtCommit,
    });

    if (bucketCommit.hash === commit.hash) {
      modules = bucketModules;
      locByModule = locAtCommit;
    }
  }

  const diffMetricsByModule = new Map<string, { added: number; deleted: number; churn: number }>();

  if (previousCommit !== null) {
    const resolver = createModuleAttributionResolver(modules);

    for (const diffRow of diffRows) {
      throwIfAborted(input.input.abortSignal);
      const attributedModule = resolver(resolveDiffAttributionPath(diffRow));

      if (attributedModule && !diffRow.isBinary && diffRow.added !== null && diffRow.deleted !== null) {
        const currentMetric = diffMetricsByModule.get(attributedModule.key) ?? {
          added: 0,
          deleted: 0,
          churn: 0,
        };
        currentMetric.added += diffRow.added;
        currentMetric.deleted += diffRow.deleted;
        currentMetric.churn += diffRow.added + diffRow.deleted;
        diffMetricsByModule.set(attributedModule.key, currentMetric);
      }

      progressEntry.processedWorkUnits += 1;
      progressEntry.currentModule = attributedModule?.name ?? null;
      await publishSnapshotProgress({
        publish: input.publish,
        input: input.input,
        totalCommits: input.totalCommits,
        sampledCommits: input.sampledCommits.length,
        snapshotIndex: input.snapshotIndex,
        currentCommit: commit.hash,
        currentModule: progressEntry.currentModule,
        currentFiles: progressEntry.totalWorkUnits,
        processedFiles: progressEntry.processedWorkUnits,
        startedAtMs: input.startedAtMs,
        currentSnapshotStartedAtMs,
        progressState: input.progressState,
      });
    }
  }

  const points = modules.map((module) => {
    const loc = locByModule.get(module.key) ?? 0;
    const diffMetric =
      previousCommit === null
        ? { added: loc, deleted: 0, churn: loc }
        : (diffMetricsByModule.get(module.key) ?? { added: 0, deleted: 0, churn: 0 });

    return {
      analysisId: input.input.analysisId,
      ts: commit.committedAt,
      commit: commit.hash,
      moduleKey: module.key,
      moduleName: module.name,
      moduleKind: module.kind,
      loc,
      added: diffMetric.added,
      deleted: diffMetric.deleted,
      churn: diffMetric.churn,
    } satisfies MetricPoint;
  });

  progressEntry.processedWorkUnits = progressEntry.totalWorkUnits;
  progressEntry.currentModule = null;
  progressEntry.completed = true;
  await publishSnapshotProgress({
    publish: input.publish,
    input: input.input,
    totalCommits: input.totalCommits,
    sampledCommits: input.sampledCommits.length,
    snapshotIndex: input.snapshotIndex,
    currentCommit: commit.hash,
    currentModule: null,
    currentFiles: progressEntry.totalWorkUnits,
    processedFiles: progressEntry.totalWorkUnits,
    startedAtMs: input.startedAtMs,
    currentSnapshotStartedAtMs,
    forceCompletedSnapshots: countCompletedSnapshots(input.progressState),
    progressState: input.progressState,
  });

  return {
    snapshot,
    points,
    candles: buildObservedCandles({
      analysisId: input.input.analysisId,
      ts: commit.committedAt,
      commit: commit.hash,
      states: bucketStates,
      moduleMetaByKey: bucketModuleMetaByKey,
    }),
    moduleMetaByKey: new Map(modules.map((module) => [module.key, { name: module.name, kind: module.kind }])),
  };
}

function createAggregateSnapshotProgressState(sampledCommits: number): AggregateSnapshotProgressState {
  return {
    snapshots: Array.from({ length: sampledCommits }, () => ({
      totalWorkUnits: 0,
      processedWorkUnits: 0,
      currentCommit: null,
      currentModule: null,
      startedAtMs: null,
      completed: false,
    })),
  };
}

function countCompletedSnapshots(progressState: AggregateSnapshotProgressState) {
  return progressState.snapshots.filter((snapshot) => snapshot.completed).length;
}

function getCandleBoundaryCommits(
  bucket: GitCommit[],
  previousCommit: GitCommit | null,
  fallbackCommit: GitCommit,
): GitCommit[] {
  const firstCommit = bucket[0] ?? fallbackCommit;
  const lastCommit = bucket[bucket.length - 1] ?? fallbackCommit;

  if (bucket.length <= 1 && previousCommit) {
    if (previousCommit.hash === lastCommit.hash) {
      return [lastCommit];
    }

    return [previousCommit, lastCommit];
  }

  if (firstCommit.hash === lastCommit.hash) {
    return [lastCommit];
  }

  return [firstCommit, lastCommit];
}

function createModuleAttributionResolver(modules: ModuleUnit[]) {
  const sortedModules = [...modules].sort((left, right) => {
    const depthDelta = moduleRootDepth(right.rootPath) - moduleRootDepth(left.rootPath);
    if (depthDelta !== 0) {
      return depthDelta;
    }

    return left.rootPath.localeCompare(right.rootPath);
  });

  return (filePath: string | null): ModuleUnit | null => {
    if (!filePath) {
      return null;
    }

    for (const module of sortedModules) {
      if (isWithinModuleRoot(filePath, module.rootPath)) {
        return module;
      }
    }

    return null;
  };
}

function resolveDiffAttributionPath(diffRow: DiffStatRow): string | null {
  return diffRow.newPath ?? diffRow.oldPath;
}

function buildObservedCandles(input: {
  analysisId: string;
  ts: string;
  commit: string;
  states: Array<{ commit: GitCommit; locByModule: Map<string, number> }>;
  moduleMetaByKey: Map<string, { name: string; kind: string }>;
}): ModuleCandlePoint[] {
  const firstState = input.states[0];
  const lastState = input.states[input.states.length - 1];
  if (!firstState || !lastState) {
    return [];
  }

  const moduleKeys = new Set<string>();
  for (const state of input.states) {
    for (const moduleKey of state.locByModule.keys()) {
      moduleKeys.add(moduleKey);
    }
  }

  return Array.from(moduleKeys)
    .map((moduleKey) => {
      const meta = input.moduleMetaByKey.get(moduleKey);
      if (!meta) {
        return null;
      }

      const observed = input.states.map((state) => state.locByModule.get(moduleKey) ?? 0);
      return {
        analysisId: input.analysisId,
        ts: input.ts,
        commit: input.commit,
        moduleKey,
        moduleName: meta.name,
        moduleKind: meta.kind,
        open: firstState.locByModule.get(moduleKey) ?? 0,
        high: observed.reduce((max, value) => Math.max(max, value), 0),
        low: observed.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY),
        close: lastState.locByModule.get(moduleKey) ?? 0,
      };
    })
    .filter((candle): candle is ModuleCandlePoint => candle !== null);
}

function moduleRootDepth(rootPath: string): number {
  if (rootPath === ".") {
    return 0;
  }

  return rootPath.split("/").length;
}

function isWithinModuleRoot(filePath: string, rootPath: string): boolean {
  if (rootPath === ".") {
    return true;
  }

  return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

async function publishSnapshotProgress(input: {
  publish: ReturnType<typeof createProgressPublisher>;
  input: AnalyzeRustHistoryInput;
  totalCommits: number;
  sampledCommits: number;
  snapshotIndex: number;
  currentCommit: string;
  currentModule: string | null;
  currentFiles: number;
  processedFiles: number;
  startedAtMs: number;
  currentSnapshotStartedAtMs: number;
  forceCompletedSnapshots?: number;
  progressState?: AggregateSnapshotProgressState;
}) {
  const completedSnapshots =
    input.forceCompletedSnapshots ?? input.progressState?.snapshots.filter((snapshot) => snapshot.completed).length ?? input.snapshotIndex;
  const totalFraction = input.progressState
    ? input.progressState.snapshots.reduce((sum, snapshot) => {
        if (snapshot.totalWorkUnits <= 0) {
          return sum + (snapshot.completed ? 1 : 0);
        }

        return sum + Math.min(snapshot.processedWorkUnits / snapshot.totalWorkUnits, 1);
      }, 0) / Math.max(input.sampledCommits, 1)
    : (input.snapshotIndex + (input.currentFiles > 0 ? input.processedFiles / input.currentFiles : 1)) /
      Math.max(input.sampledCommits, 1);
  const percent = 10 + totalFraction * 85;

  const etaSeconds = input.progressState
    ? estimateConcurrentSnapshotEtaSeconds({
        sampledCommits: input.sampledCommits,
        snapshots: input.progressState.snapshots,
        startedAtMs: input.startedAtMs,
      })
    : estimateSnapshotEtaSeconds({
        sampledCommits: input.sampledCommits,
        snapshotIndex: input.snapshotIndex,
        currentFiles: input.currentFiles,
        processedFiles: input.processedFiles,
        startedAtMs: input.startedAtMs,
        currentSnapshotStartedAtMs: input.currentSnapshotStartedAtMs,
        forceCompletedSnapshots: input.forceCompletedSnapshots,
      });

  await publishProgress(input.publish, input.input, {
    phase: "analyzing-snapshots",
    percent: Math.min(95, Number(percent.toFixed(2))),
    totalCommits: input.totalCommits,
    sampledCommits: input.sampledCommits,
    completedSnapshots,
    currentCommit: input.currentCommit,
    currentModule: input.currentModule,
    currentFiles: input.currentFiles,
    processedFiles: input.processedFiles,
    etaSeconds,
    startedAt: input.input.startedAt,
    updatedAt: new Date().toISOString(),
  });
}

async function publishProgress(
  publish: ReturnType<typeof createProgressPublisher>,
  input: AnalyzeRustHistoryInput,
  progress: AnalysisProgress,
) {
  throwIfAborted(input.abortSignal);
  await publish(progress);
}
