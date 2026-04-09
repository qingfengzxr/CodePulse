import type { AnalysisProgress, MetricPoint, ModuleUnit, Snapshot } from "@code-dance/domain";
import {
  detectRustModulesAtRevision,
  listCommits,
  readNumstatBetweenRevisions,
  sampleCommits,
} from "@code-dance/git";
import type { DiffStatRow } from "@code-dance/git";
import { countModuleLocAtRevision } from "../shared/loc-counter.js";
import { throwIfAborted } from "../shared/abort.js";
import { estimateSnapshotEtaSeconds } from "../shared/progress-estimate.js";
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

  const sampledCommits = sampleCommits(commits, input.sampling);

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
  const previousModuleKeys = new Set<string>();

  for (let snapshotIndex = 0; snapshotIndex < sampledCommits.length; snapshotIndex += 1) {
    throwIfAborted(input.abortSignal);
    const commit = sampledCommits[snapshotIndex]!;
    const previousCommit = sampledCommits[snapshotIndex - 1] ?? null;
    const modules = await detectRustModulesAtRevision(input.localPath, commit.hash);
    throwIfAborted(input.abortSignal);
    const currentModulesByKey = new Map(modules.map((module) => [module.key, module]));
    const locFiles = countDistinctModuleFiles(modules);
    const diffRows =
      previousCommit === null
        ? []
        : await readNumstatBetweenRevisions(input.localPath, previousCommit.hash, commit.hash);
    const totalWorkUnits = locFiles + diffRows.length;

    snapshots.push({
      analysisId: input.analysisId,
      commit: commit.hash,
      ts: commit.committedAt,
    });

    let processedWorkUnits = 0;
    const currentSnapshotStartedAtMs = Date.now();
    const moduleNameByKey = new Map(modules.map((module) => [module.key, module.name]));
    const locByModule = await countModuleLocAtRevision({
      localPath: input.localPath,
      revision: commit.hash,
      modules,
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

    const diffMetricsByModule = new Map<
      string,
      { added: number; deleted: number; churn: number }
    >();

    if (previousCommit !== null) {
      const resolver = createModuleAttributionResolver(modules);

      for (const diffRow of diffRows) {
        throwIfAborted(input.abortSignal);
        const attributedModule = resolver(resolveDiffAttributionPath(diffRow));

        if (
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

    for (const moduleKey of previousModuleKeys) {
      if (currentModulesByKey.has(moduleKey)) {
        continue;
      }

      points.push({
        analysisId: input.analysisId,
        ts: commit.committedAt,
        commit: commit.hash,
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
    for (const module of modules) {
      previousModuleKeys.add(module.key);
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

async function publishProgress(input: AnalyzeRustHistoryInput, progress: AnalysisProgress) {
  throwIfAborted(input.abortSignal);
  await input.onProgress?.(progress);
}
