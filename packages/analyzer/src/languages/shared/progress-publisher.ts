import type { AnalysisProgress } from "@code-dance/domain";
import type { AnalyzeRepositoryHistoryInput } from "./types.js";
import { throwIfAborted } from "./abort.js";
import { resolveAnalyzerPerformanceOptions } from "./runtime-options.js";

export function createProgressPublisher(input: AnalyzeRepositoryHistoryInput) {
  const { progressThrottleMs } = resolveAnalyzerPerformanceOptions(input.performance);
  let lastPublishedAt = 0;
  let lastProgress: AnalysisProgress | null = null;

  return async (progress: AnalysisProgress) => {
    throwIfAborted(input.abortSignal);

    const now = Date.now();
    const shouldPublish =
      lastProgress === null ||
      progress.phase !== "analyzing-snapshots" ||
      progressThrottleMs === 0 ||
      progress.completedSnapshots !== lastProgress.completedSnapshots ||
      (progress.currentFiles !== null &&
        progress.processedFiles !== null &&
        progress.processedFiles >= progress.currentFiles) ||
      now - lastPublishedAt >= progressThrottleMs;

    if (!shouldPublish) {
      return;
    }

    lastPublishedAt = now;
    lastProgress = progress;
    await input.onProgress?.(progress);
  };
}
