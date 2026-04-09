export type AnalyzerPerformanceOptions = {
  fileReadConcurrency?: number;
  analyzerConcurrency?: number;
  snapshotConcurrency?: number;
  progressThrottleMs?: number;
};

export type ResolvedAnalyzerPerformanceOptions = {
  fileReadConcurrency: number;
  analyzerConcurrency: number;
  snapshotConcurrency: number;
  progressThrottleMs: number;
};

const DEFAULT_FILE_READ_CONCURRENCY = 6;
const DEFAULT_ANALYZER_CONCURRENCY = 1;
const DEFAULT_SNAPSHOT_CONCURRENCY = 1;
const DEFAULT_PROGRESS_THROTTLE_MS = 200;

export function resolveAnalyzerPerformanceOptions(
  value: AnalyzerPerformanceOptions | undefined,
): ResolvedAnalyzerPerformanceOptions {
  return {
    fileReadConcurrency: normalizePositiveInteger(
      value?.fileReadConcurrency,
      DEFAULT_FILE_READ_CONCURRENCY,
    ),
    analyzerConcurrency: normalizePositiveInteger(
      value?.analyzerConcurrency,
      DEFAULT_ANALYZER_CONCURRENCY,
    ),
    snapshotConcurrency: normalizePositiveInteger(
      value?.snapshotConcurrency,
      DEFAULT_SNAPSHOT_CONCURRENCY,
    ),
    progressThrottleMs: normalizeNonNegativeInteger(
      value?.progressThrottleMs,
      DEFAULT_PROGRESS_THROTTLE_MS,
    ),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}
