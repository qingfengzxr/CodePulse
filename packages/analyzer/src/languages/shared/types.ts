import type {
  AnalysisProgress,
  ModuleCandlePoint,
  AnalysisSampling,
  MetricPoint,
  RepositoryKind,
  Snapshot,
} from "@code-dance/domain";
import type { AnalyzerPerformanceOptions } from "./runtime-options.js";

export type AnalyzeRepositoryHistoryInput = {
  analysisId: string;
  localPath: string;
  branch: string;
  sampling: AnalysisSampling;
  detectedKinds: RepositoryKind[];
  startedAt: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void | Promise<void>;
  performance?: AnalyzerPerformanceOptions;
  // Test-only hook for forcing analyzer outputs without touching the filesystem.
  __testOverrides?: Partial<
    Record<
      "rust" | "node" | "go",
      (input: AnalyzeRepositoryHistoryInput) => Promise<AnalyzeRepositoryHistoryOutput>
    >
  >;
};

export type AnalyzeRepositoryHistoryOutput = {
  snapshots: Snapshot[];
  points: MetricPoint[];
  candles: ModuleCandlePoint[];
};
