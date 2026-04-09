import type {
  AnalysisProgress,
  MetricPoint,
  ModuleCandlePoint,
  ModuleUnit,
  Snapshot,
} from "@code-dance/domain";
import {
  bucketCommits,
  detectNodeModulesAtRevision,
  listCommits,
  readNumstatBetweenRevisions,
  type DiffStatRow,
  type GitCommit,
} from "@code-dance/git";

import type {
  AnalyzeRepositoryHistoryInput,
  AnalyzeRepositoryHistoryOutput,
} from "../shared/types.js";
import { throwIfAborted } from "../shared/abort.js";
import { countModuleLocAtRevision } from "../shared/loc-counter.js";
import { estimateSnapshotEtaSeconds } from "../shared/progress-estimate.js";

export type AnalyzeNodeHistoryInput = AnalyzeRepositoryHistoryInput;
export type AnalyzeNodeHistoryOutput = AnalyzeRepositoryHistoryOutput;

export async function analyzeNodeHistory(
  input: AnalyzeNodeHistoryInput,
): Promise<AnalyzeNodeHistoryOutput> {
  if (!input.detectedKinds.includes("node")) {
    throw new Error("repository is not detected as node");
  }

  const startedAtMs = Date.parse(input.startedAt);

  await publishProgress(input, {
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

  await publishProgress(input, {
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

  await publishProgress(input, {
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

  const snapshots: Snapshot[] = [];
  const points: MetricPoint[] = [];
  const candles: ModuleCandlePoint[] = [];
  const previousModulesByKey = new Map<string, { name: string; kind: string }>();

  for (let snapshotIndex = 0; snapshotIndex < sampledCommits.length; snapshotIndex += 1) {
    throwIfAborted(input.abortSignal);
    const commit = sampledCommits[snapshotIndex]!;
    const bucket = commitBuckets[snapshotIndex]!;
    const previousCommit = sampledCommits[snapshotIndex - 1] ?? null;
    const diffRows =
      previousCommit === null
        ? []
        : await readNumstatBetweenRevisions(input.localPath, previousCommit.hash, commit.hash);

    snapshots.push({
      analysisId: input.analysisId,
      commit: commit.hash,
      ts: commit.committedAt,
    });

    let processedWorkUnits = 0;
    let totalWorkUnits = diffRows.length;
    const currentSnapshotStartedAtMs = Date.now();
    const bucketStates: Array<{
      commit: GitCommit;
      locByModule: Map<string, number>;
    }> = [];
    const bucketModuleMetaByKey = new Map<string, { name: string; kind: string }>();
    let modules: ModuleUnit[] = [];
    let locByModule = new Map<string, number>();

    for (const bucketCommit of bucket) {
      throwIfAborted(input.abortSignal);
      const bucketModules = (await detectNodeModulesAtRevision(input.localPath, bucketCommit.hash)).filter(
        (module) => module.files.length > 0,
      );
      throwIfAborted(input.abortSignal);
      totalWorkUnits += countDistinctModuleFiles(bucketModules);
      const moduleNameByKey = new Map(bucketModules.map((module) => [module.key, module.name]));
      const locAtCommit = await countModuleLocAtRevision({
        localPath: input.localPath,
        revision: bucketCommit.hash,
        modules: bucketModules,
        abortSignal: input.abortSignal,
        onFileProcessed: async ({ moduleKey }) => {
          throwIfAborted(input.abortSignal);
          processedWorkUnits += 1;
          await publishSnapshotProgress({
            input,
            totalCommits: commits.length,
            sampledCommits: sampledCommits.length,
            snapshotIndex,
            currentCommit: commit.hash,
            currentModule: moduleNameByKey.get(moduleKey) ?? null,
            currentFiles: totalWorkUnits,
            processedFiles: processedWorkUnits,
            startedAtMs,
            currentSnapshotStartedAtMs,
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

    const currentModulesByKey = new Map(modules.map((module) => [module.key, module]));

    const diffMetricsByModule = new Map<
      string,
      { added: number; deleted: number; churn: number }
    >();

    if (previousCommit !== null) {
      const resolver = createModuleAttributionResolver(modules);

      for (const diffRow of diffRows) {
        throwIfAborted(input.abortSignal);
        const attributionPath = resolveDiffAttributionPath(diffRow);
        const attributedModule = resolver(attributionPath);

        if (
          attributionPath &&
          isFrontendSourcePath(attributionPath) &&
          attributedModule &&
          !diffRow.isBinary &&
          diffRow.added !== null &&
          diffRow.deleted !== null
        ) {
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

        processedWorkUnits += 1;
        await publishSnapshotProgress({
          input,
          totalCommits: commits.length,
          sampledCommits: sampledCommits.length,
          snapshotIndex,
          currentCommit: commit.hash,
          currentModule: attributedModule?.name ?? null,
          currentFiles: totalWorkUnits,
          processedFiles: processedWorkUnits,
          startedAtMs,
          currentSnapshotStartedAtMs,
        });
      }
    }

    for (const module of modules) {
      const loc = locByModule.get(module.key) ?? 0;
      const diffMetric =
        previousCommit === null
          ? { added: loc, deleted: 0, churn: loc }
          : (diffMetricsByModule.get(module.key) ?? { added: 0, deleted: 0, churn: 0 });

      points.push({
        analysisId: input.analysisId,
        ts: commit.committedAt,
        commit: commit.hash,
        moduleKey: module.key,
        moduleName: module.name,
        moduleKind: module.kind,
        loc,
        added: diffMetric.added,
        deleted: diffMetric.deleted,
        churn: diffMetric.churn,
      });
    }

    candles.push(
      ...buildObservedCandles({
        analysisId: input.analysisId,
        ts: commit.committedAt,
        commit: commit.hash,
        states: bucketStates,
        moduleMetaByKey: bucketModuleMetaByKey,
      }),
    );

    for (const [moduleKey, previousModule] of previousModulesByKey.entries()) {
      if (currentModulesByKey.has(moduleKey)) {
        continue;
      }

      points.push({
        analysisId: input.analysisId,
        ts: commit.committedAt,
        commit: commit.hash,
        moduleKey,
        moduleName: previousModule.name,
        moduleKind: previousModule.kind,
        loc: 0,
        added: 0,
        deleted: 0,
        churn: 0,
      });
    }

    previousModulesByKey.clear();
    for (const module of modules) {
      previousModulesByKey.set(module.key, {
        name: module.name,
        kind: module.kind,
      });
    }

    await publishSnapshotProgress({
      input,
      totalCommits: commits.length,
      sampledCommits: sampledCommits.length,
      snapshotIndex,
      currentCommit: commit.hash,
      currentModule: null,
      currentFiles: totalWorkUnits,
      processedFiles: totalWorkUnits,
      startedAtMs,
      currentSnapshotStartedAtMs,
      forceCompletedSnapshots: snapshotIndex + 1,
    });
  }

  await publishProgress(input, {
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

const FRONTEND_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css"];

function isFrontendSourcePath(filePath: string): boolean {
  return FRONTEND_SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

async function publishSnapshotProgress(input: {
  input: AnalyzeNodeHistoryInput;
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
}) {
  const completedSnapshots = input.forceCompletedSnapshots ?? input.snapshotIndex;
  const snapshotFraction = input.currentFiles > 0 ? input.processedFiles / input.currentFiles : 1;
  const totalFraction =
    (input.snapshotIndex + snapshotFraction) / Math.max(input.sampledCommits, 1);
  const percent = 10 + totalFraction * 85;

  const etaSeconds = estimateSnapshotEtaSeconds({
    sampledCommits: input.sampledCommits,
    snapshotIndex: input.snapshotIndex,
    currentFiles: input.currentFiles,
    processedFiles: input.processedFiles,
    startedAtMs: input.startedAtMs,
    currentSnapshotStartedAtMs: input.currentSnapshotStartedAtMs,
    forceCompletedSnapshots: input.forceCompletedSnapshots,
  });

  await publishProgress(input.input, {
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

async function publishProgress(input: AnalyzeNodeHistoryInput, progress: AnalysisProgress) {
  throwIfAborted(input.abortSignal);
  await input.onProgress?.(progress);
}
